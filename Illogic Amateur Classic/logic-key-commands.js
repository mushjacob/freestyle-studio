/** Default key command set for Illogic Amateur.
 *
 * One row per default key command of the reference workstation's U.S. key
 * command set (rows carry that set's numeric command id so each binding can be
 * traced back to its source). `scope` says where the command applies:
 *   G global · T Tracks area · P Piano Roll · S Step Sequencer · M Mixer
 *   · X tool menu open (T, then the tool key)
 * `action` says what Illogic does with it:
 *   '=command'  runs that command (see logic-shell.js / app.js handlers)
 *   '~'         already owned by the transport / edit layers below this one
 *   '!reason'   bound: answers with the reason it cannot run on Freestyle
 * A leading '^' marks combos a normal browser tab reserves for itself; they
 * still work where the key reaches the page (installed app, embedded view).
 *
 * This module is data plus a matcher: no I/O.
 */
const NO={
 take:'Freestyle keeps one recording per region; there are no take folders.',
 marker:'Freestyle projects have no markers.',
 global:'Freestyle projects have no global tracks (tempo and signature are in Track ▸ Tempo & Time Signatures…).',
 auto:'Freestyle automation has no Off / Read / Touch / Latch modes; open Track Automation (A).',
 stack:'Freestyle has no track stacks or folders.',
 group:'Freestyle has no mixer groups.',
 punch:'Freestyle recording has no punch locators.',
 alt:'Freestyle has no track alternatives.',
 flex:'Freestyle has no Flex Time / Flex Pitch.',
 transient:'Freestyle does not expose audio transients.',
 score:'There is no Score Editor.',
 list:'There are no List Editors (Event, Marker, Tempo, Signature).',
 smpte:'Freestyle has no SMPTE position lock.',
 zoomTrack:'All tracks share one height; use ⌘↑ / ⌘↓.',
 movie:'Freestyle projects have no movie track.',
 loops:'There is no Live Loops grid.',
 hide:'Freestyle cannot hide tracks.',
 strip:'Freestyle stores no channel strip setting library; use Copy / Paste Channel Strip Setting (⌥⌘C / ⌥⌘V).',
 os:'macOS and the browser own this window command.',
 section:'Freestyle has no global section cut / insert / repeat.',
 colour:'Freestyle regions and tracks have no colour field.',
 stepMode:'This Step Sequencer has Step On/Off and Velocity rows only.',
 rowMode:'Freestyle patterns play forward only.',
 loopRow:'Freestyle pattern rows have no separate loop start / end.',
 subrow:'This Step Sequencer shows the velocity sub-row with the graph button (⌃⌘→ / ⌃⌘←).',
};
/** [id, keys, name, scope, action] */
const ROWS=[
 // ── Transport
 [3,'kpEnter','Play','G','=play'],[4,'kp.','Pause','G','=pause'],[5,'kp0','Stop','G','=stop'],
 [7,'R','Record','G','=record'],[8,'kp*','Record / Record Toggle','G','=record'],
 [9,'⌘.','Discard Recording and Return to Last Play Position','G','!Freestyle keeps a finished recording; press ⌘Z to remove it.'],
 [10,',','Rewind','G','=move-bars:-1'],[11,'.','Forward','G','=move-bars:1'],[12,'⇧,','Fast Rewind','G','=move-bars:-8'],[13,'⇧.','Fast Forward','G','=move-bars:8'],
 [15,'C','Cycle Mode','G','=toggle-cycle'],[16,'⌃⌥⌘P','Autopunch Mode','G','!'+NO.punch],[20,'kp/','Replace','G','!Freestyle recording always adds a new region; there is no Replace mode.'],
 [21,'/','Go to Position…','G','=go-to-position'],[535,'Space','Play or Stop','G','~'],[544,'⇧Space','Play from Selection','G','=play-from-selection'],
 [683,'⇧Enter','Play from Left Window Edge','G','=play-from-left-edge'],[1222,'Return','Go to Beginning','G','=go-to-start'],[1240,'⌥Return','Go to End of Last Region','G','=go-to-end'],
 [682,'⌃Home','Go to Selection Start','G','=go-to-selection:start'],[1221,'⌃End','Go to Selection End','G','=go-to-selection:end'],
 [480,'⌃⇧,','Go to Left Locator','G','=go-to-locator:left'],[481,'⌃⇧.','Go to Right Locator','G','=go-to-locator:right'],
 [1285,'⌃.','Forward by Transient','G','!'+NO.transient],[1286,'⌃,','Rewind by Transient','G','!'+NO.transient],
 [474,'K','Metronome Click','G','=toggle-metronome'],[1291,'⇧K','Count-in','G','=toggle-count-in'],
 [542,'⇧R','Flashback Capture as Recording','G','!Freestyle does not buffer what you play while stopped.'],[1369,'⌃⌥⌘R','Free Tempo Recording','G','!Freestyle records at the project tempo only.'],
 [698,'kp=','Skip Cycle','G','!Freestyle has no skip cycle.'],
 // ── Locators / cycle
 [100,'⌘U','Set Locators by Regions/Events/Marquee and Enable Cycle','TP','=locators-to-selection'],[123,'U','Set Rounded Locators by Regions/Events/Marquee and Enable Cycle','TP','=locators-to-selection:rounded'],
 [699,'⇧⌘.','Move Locators Forward by Cycle Length','G','=move-locators:1'],[700,'⇧⌘,','Move Locators Backwards by Cycle Length','G','=move-locators:-1'],
 [1388,'⌥⇧⌘.','Double Cycle Length','G','=scale-locators:2'],[1389,'⌥⇧⌘,','Halve Cycle Length','G','=scale-locators:0.5'],
 [505,'⌃⌥⌘I','Set Punch In Locator by Playhead','G','!'+NO.punch],[506,'⌃⌥⌘O','Set Punch Out Locator by Playhead','G','!'+NO.punch],[509,'⌃⌥⇧⌘I','Set Punch In Locator by Rounded Playhead','G','!'+NO.punch],[510,'⌃⌥⇧⌘O','Set Punch Out Locator by Rounded Playhead','G','!'+NO.punch],
 // ── Markers
 [513,'⌥\'','Create Marker','G','!'+NO.marker],[514,'⌥Delete','Delete Marker','G','!'+NO.marker],[515,'⌥.','Go to Next Marker and Set Locators','G','!'+NO.marker],[516,'⌥,','Go to Previous Marker and Set Locators','G','!'+NO.marker],[520,'⌥/','Go to Marker Number…','G','!'+NO.marker],[528,'⌃⌥\'','Create Marker without rounding','G','!'+NO.marker],
 [695,'⌃⌥C','Set Locators by Marker and Enable Cycle','G','!'+NO.marker],[696,'⌃⌥,','Set Locators by Previous Marker and Enable Cycle','G','!'+NO.marker],[697,'⌃⌥.','Set Locators by Next Marker and Enable Cycle','G','!'+NO.marker],
 [1191,'⌥⇧\'','Create Marker for Region/Marquee Selection','G','!'+NO.marker],[1192,'⇧\'','Rename Marker','G','!'+NO.marker],[2244,'\'','Show/Hide Marker Track Only','T','!'+NO.global],
 // ── Views and windows
 [45,'I','Show/Hide Inspector','G','=toggle-inspector'],[735,'X','Show/Hide Mixer','G','=toggle-mixer'],[1274,'E','Show/Hide Editor','G','=toggle-editors'],[739,'P','Show/Hide Piano Roll','G','=toggle-piano-roll'],
 [749,'B','Show/Hide Browser','G','=toggle-library'],[1253,'O','Show/Hide Project Files','G','=toggle-browser'],[1296,'Y','Show/Hide Smart Controls','G','!Smart Controls are not available for Freestyle cloud tracks.'],
 [743,'W','Show/Hide Audio File Editor','G','=toggle-audio-editor'],[736,'N','Show/Hide Score Editor','G','!'+NO.score],[1254,'D','Show/Hide List Editors','G','!'+NO.list],[1255,'V','Show/Hide All Plug-in Windows','G','=toggle-plugin-windows'],
 [116,'A','Show/Hide Automation','G','=toggle-automation'],[893,'G','Show/Hide Global Tracks','T','!'+NO.global],[1753,'F','Show/Hide Flex Pitch/Time','T','!'+NO.flex],[1710,'H','Toggle Hide View','T','!'+NO.hide],
 [1385,'L','Switch between Live Loops Grid and Tracks View','T','!'+NO.loops],[1390,'⌥L','Show Both, Live Loops Grid and Tracks View','T','!'+NO.loops],
 [1304,'⌘K','Show/Hide Musical Typing','G','=toggle-musical-typing'],[1208,'⌥⌘K','Show/Hide Step Input Keyboard','G','!Step input is not available; use Musical Typing (⌘K) while recording.'],
 [1290,'⇧/','Show/Hide Quick Help','G','!Every control shows its help as a tooltip when you point at it; there is no Quick Help pane.'],[1293,'⌘/','Show Detailed Help','G','=help'],[35,'⌥K','Open Key Command Assignments…','G','=key-commands'],[39,'⌥⇧T','Open Tempo List…','G','=tempo-list'],
 [1282,'⌃⇧P','Show/Hide Note Pad','G','!Freestyle projects have no notes field to save a Note Pad in.'],[1297,'⌃⌘F','Enter/Exit Full Screen','G','=full-screen'],[1758,'⌃⌥⌘T','Show/Hide Toolbar','G','!There is no customisable toolbar; its commands are in the menus.'],
 [33,'⌥⇧R','Region Inspector Float','G','!The Region inspector is in the Inspector (I).'],[475,'⌥E','Show/Hide Event Float','G','!'+NO.list],[483,'⌥C','Show/Hide Colors','G','!'+NO.colour],[1280,'⌥⇧G','Show/Hide Groups Window','G','!'+NO.group],
 [686,'⌘1','Open Main Window…','G','^=show-tracks'],[690,'⌘2','Open Mixer…','G','^=open-mixer'],[2909,'⌘3','Open Step Sequencer…','G','^=open-step'],[489,'⌘4','Open Piano Roll…','G','^=open-piano'],[488,'⌘5','Open Score Editor…','G','^!'+NO.score],[498,'⌘6','Open Audio File Editor…','G','^=open-audio-editor'],[487,'⌘7','Open Event List…','G','^!'+NO.list],[497,'⌘8','Open Project Audio…','G','^!The project’s audio files are listed in the Browser (B).'],[775,'⌘9','Open Transform…','G','^=midi-transform'],[495,'⌘0','Open Environment…','G','^!There is no MIDI Environment.'],
 [2315,'Tab','Cycle Through Window Views','G','=cycle-views:1'],[2316,'⇧Tab','Cycle Through Window Views (counter-clockwise)','G','=cycle-views:-1'],[545,'⌘`','Cycle Through Windows','G','^=cycle-views:1'],[799,'⌥⇧W','Cycle Through Windows (counter-clockwise)','G','=cycle-views:-1'],
 [529,'⌘W','Close Window','G','^!'+NO.os],[1252,'⌘M','Minimize Window','G','^!'+NO.os],[2312,'⌘H','Hide Application','G','^!'+NO.os],[2313,'⌥⌘H','Hide Others','G','^!'+NO.os],[2314,'⌥⌘M','Minimize All Windows','G','^!'+NO.os],[772,'⌃⌘M','Zoom Window','G','!'+NO.os],
 [2248,'⌥⇧I','Show/Hide Local Inspector','P','=toggle-local-inspector'],[1522,'⌃⌥⇧R','Secondary Ruler','G','!The ruler shows bars and beats only.'],
 // ── Zoom and navigation
 [41,'⌘←','Zoom Horizontal Out','G','=zoom-horizontal:-1'],[42,'⌘→','Zoom Horizontal In','G','=zoom-horizontal:1'],[43,'⌘↑','Zoom Vertical Out','G','=zoom-vertical:-1'],[44,'⌘↓','Zoom Vertical In','G','=zoom-vertical:1'],
 [2225,'Z','Toggle Zoom to fit Selection or All Contents','TP','=zoom-to-fit'],[77,'⌃⇧Z','Zoom to fit Locators, store Navigation Snapshot','T','=zoom-to-locators'],[79,'⇧Z','Store Navigation Snapshot','T','=nav-store'],[78,'⌥Z','Navigation: Back','T','=nav-step:-1'],[76,'⌥⇧Z','Navigation: Forward','T','=nav-step:1'],
 [63,'⌃⌥⌘1','Recall Zoom 1','T','=zoom-recall:1'],[64,'⌃⌥⌘2','Recall Zoom 2','T','=zoom-recall:2'],[65,'⌃⌥⌘3','Recall Zoom 3','T','=zoom-recall:3'],[66,'⌃⌥⇧⌘1','Save as Zoom 1','T','=zoom-save:1'],[67,'⌃⌥⇧⌘2','Save as Zoom 2','T','=zoom-save:2'],[68,'⌃⌥⇧⌘3','Save as Zoom 3','T','=zoom-save:3'],
 [46,'PgUp','Page Up','TP','=page:up'],[47,'PgDn','Page Down','TP','=page:down'],[48,'Home','Page Left','TP','=page:left'],[49,'End','Page Right','TP','=page:right'],
 [51,'`','Catch Playhead Position','G','=toggle-catch'],[884,'⌃`','Scroll in Play','G','!The playhead moves over a still Tracks area; Scroll in Play is not available.'],[364,'⇧`','Scroll to Selection','TP','=scroll-to-selection'],
 [589,'⌥⌘↓','Individual Track Zoom In','T','!'+NO.zoomTrack],[590,'⌥⌘↑','Individual Track Zoom Out','T','!'+NO.zoomTrack],[597,'⌥⌘Z','Toggle Individual Track Zoom','T','!'+NO.zoomTrack],[598,'⌃Z','Toggle Zoom Focused Track','T','!'+NO.zoomTrack],[591,'⌥⌘FwdDel','Reset Individual Track Zoom','T','!'+NO.zoomTrack],[592,'⌥⇧⌘FwdDel','Individual Track Zoom Reset for All Tracks','T','!'+NO.zoomTrack],
 [1705,'⌘-','Waveform Vertical Zoom Out','T','=waveform-zoom:-1'],[1706,'⌘=','Waveform Vertical Zoom In','T','=waveform-zoom:1'],
 // ── Tools
 [40,'T','Show Tool Menu','TPS','=tool-menu'],[70,'⌥PgDn','Set Next Tool','TP','=tool-step:1'],[71,'⌥PgUp','Set Previous Tool','TP','=tool-step:-1'],
 // ── File
 [751,'⌘N','New from Template…','G','^=new-project'],[785,'⇧⌘N','New Empty Project','G','^=new-project'],[752,'⌘O','Open…','G','~'],[754,'⌘S','Save','G','~'],[32,'⇧⌘S','Save Project as…','G','~'],[753,'⌥⌘W','Close Project','G','^!Projects stay open in Freestyle; choose another with File ▸ Open… (⌘O).'],
 [757,'⌘P','Print','G','!'+NO.score],[758,'⌘I','Import…','G','=import-other'],[1186,'⇧⌘I','Import Audio File…','G','=import-audio'],[759,'⌥⌘E','Export Selection as MIDI File…','G','=export-selection-midi'],
 [1151,'⌘B','Bounce Project or Section…','G','=bounce'],[1178,'⌘E','Export Tracks as Audio Files…','G','!Freestyle bounces the whole mix (⌘B); per-track audio export is not available.'],[1179,'⇧⌘E','Export All Tracks as Audio Files…','G','!Freestyle bounces the whole mix (⌘B); per-track audio export is not available.'],
 [1748,'⌃B','Bounce Regions in Place…','T','!Freestyle has no bounce in place.'],[1749,'⌃⌘B','Bounce Tracks in Place','T','!Freestyle has no bounce in place.'],[1170,'⌥P','Project Settings…','G','=project-settings'],[30,'⌘,','Open Settings…','G','=project-settings'],[760,'⌘Q','Quit','G','^!'+NO.os],
 [1194,'⌥⌘O','Open Movie…','G','!'+NO.movie],[1765,'⌃⇧O','Add to Browser…','T','!The Browser lists Freestyle’s catalogue; regions cannot be added to it.'],
 // ── Edit
 [761,'⌘Z','Undo','G','~'],[796,'⇧⌘Z','Redo','G','~'],[797,'⌃⌥⌘Z','Undo History…','G','=undo-history'],[762,'⌘X','Cut','G','~'],[763,'⌘C','Copy','G','~'],[764,'⌘V','Paste','G','~'],[766,'⌘A','Select All','G','~'],[0,'Delete','Delete','G','~'],
 [383,'⇧⌘V','Paste Replace','TP','!Paste always adds; delete the old regions or notes first.'],[2276,'⌘R','Repeat Regions/Events','T','=repeat-regions'],[2276,'⌘R','Repeat Regions/Events','P','=repeat-notes'],
 [90,'⌘J','Join Regions/Notes','T','=join-regions'],[90,'⌘J','Join Regions/Notes','P','=join-notes'],[553,'J','Join Regions per Tracks','T','!Freestyle has no region join operation.'],
 [574,'⌘T','Split Regions/Events at Playhead Position','T','^=split-at-playhead'],[574,'⌘T','Split Regions/Events at Playhead Position','P','^=split-notes-at-playhead'],[91,'⌥⌘T','Split Regions/Events at Locators or Marquee Selection','T','=split-at-locators'],
 [60,'⌃M','Mute Notes/Regions/Folders on/off','T','=mute-regions'],[60,'⌃M','Mute Notes/Regions/Folders on/off','P','=mute-notes'],[121,'⌃S','Solo Tracks of Selected Regions','T','=solo-selected-regions'],
 [2504,'⌘G','Snap to Grid','TP','=toggle-snap'],[2228,'⌥⌘G','Alignment Guides','T','!There are no alignment guides.'],
 [1500,'⌘[','Set Region/Event Start to Playhead Position','T','=trim-to-playhead:start'],[1501,'⌘]','Set Region/Event End to Playhead Position','T','=trim-to-playhead:end'],[1500,'⌘[','Set Region/Event Start to Playhead Position','P','=trim-notes-to-playhead:start'],[1501,'⌘]','Set Region/Event End to Playhead Position','P','=trim-notes-to-playhead:end'],
 [358,';','Move Region/Event to Playhead Position (Pickup Clock)','T','=move-to-playhead'],[358,';','Move Region/Event to Playhead Position (Pickup Clock)','P','=move-notes-to-playhead'],[359,'⇧;','Move Region/Event to Playhead Position and Select Next','TP','!Use ; to move the selection to the playhead, then → to select the next one.'],
 /* Tracks area ⌥← / ⌥→: the held-key nudge gesture (playlist-keyboard.js) owns them; one saved edit per release */[332,'⌥→','Nudge Region/Event Position Right by Nudge Value','T','~'],[333,'⌥←','Nudge Region/Event Position Left by Nudge Value','T','~'],[332,'⌥→','Nudge Region/Event Position Right by Nudge Value','P','=nudge-notes:1'],[333,'⌥←','Nudge Region/Event Position Left by Nudge Value','P','=nudge-notes:-1'],
 [1527,'⌥⇧→','Nudge Region/Event Length Right by Nudge Value','T','=nudge-length:1'],[1528,'⌥⇧←','Nudge Region/Event Length Left by Nudge Value','T','=nudge-length:-1'],[1527,'⌥⇧→','Nudge Region/Event Length Right by Nudge Value','P','=nudge-note-length:1'],[1528,'⌥⇧←','Nudge Region/Event Length Left by Nudge Value','P','=nudge-note-length:-1'],
 [334,'⌃⌥T','Set Nudge Value to Tick','TP','=nudge-value:tick'],[335,'⌃⌥D','Set Nudge Value to Division','TP','=nudge-value:division'],[336,'⌃⌥B','Set Nudge Value to Beat','TP','=nudge-value:beat'],[337,'⌃⌥M','Set Nudge Value to Bar','TP','=nudge-value:bar'],
 [338,'⌃⌥F','Set Nudge Value to SMPTE Frame','TP','!'+NO.smpte],[339,'⌃⌥H','Set Nudge Value to 0.5 SMPTE Frame','TP','!'+NO.smpte],[1526,'⌃⌥S','Set Nudge Value to Sample','T','!Regions move on the tick grid; a one-sample nudge is not available.'],[1573,'⌃⌥1','Set Nudge Value to 1 ms','TP','!Regions move on the tick grid; millisecond nudges are not available.'],[1578,'⌃⌥0','Set Nudge Value to 10 ms','TP','!Regions move on the tick grid; millisecond nudges are not available.'],
 [391,'⌥↑','Transpose Region/Event +1 Semitone','T','=transpose-regions:1'],[392,'⌥↓','Transpose Region/Event -1 Semitone','T','=transpose-regions:-1'],[1520,'⌥⇧↑','Transpose Region/Event +12 Semitones','T','=transpose-regions:12'],[1521,'⌥⇧↓','Transpose Region/Event -12 Semitones','T','=transpose-regions:-12'],
 [391,'⌥↑','Transpose Event +1 Semitone','P','=transpose-notes:1'],[392,'⌥↓','Transpose Event -1 Semitone','P','=transpose-notes:-1'],[1520,'⌥⇧↑','Transpose Event +12 Semitones','P','=transpose-notes:12'],[1521,'⌥⇧↓','Transpose Event -12 Semitones','P','=transpose-notes:-12'],
 [105,'\\','Remove Overlaps','T','=remove-overlaps'],[106,'⇧\\','Trim Region End to Next Region','T','=trim-end-to-next'],[585,'⌥\\','Trim Regions to Fill within Locators','T','!Freestyle has no fill-to-locators trim.'],[104,'⌃\\','Set Optimal Region Lengths Rounded by Bar','T','!Freestyle has no optimal region length command.'],[1707,'⌘\\','Crop Regions Outside Locators or Marquee Selection','T','=crop-to-locators'],
 [111,'⌃L','Loop Regions On/Off','T','!Freestyle regions have no loop flag; use Repeat (⌘R).'],[103,'⌃⌘L','Convert Loops to Regions','T','!Freestyle regions have no loop flag; use Repeat (⌘R).'],[96,'⌃A','Convert Alias to a Region Copy','T','=make-unique'],[579,'⌥⌘R','Convert Regions to New Regions','T','=make-unique'],[569,'⌥⇧A','Select All Aliases of Region','T','!Freestyle has no region aliases.'],
 [101,'⌃N','Apply All Region Parameters Permanently','T','!Freestyle regions have no playback parameters to apply.'],[102,'⌃Q','Apply Quantization Permanently','T','!Quantize notes in the Piano Roll (Q); it is always permanent.'],[1122,'⌃⌥⌘M','Convert to MIDI Region','T','!Open a pattern region in the Piano Roll (P) to edit it as MIDI.'],
 [582,'⌥⌘F','Convert Regions to New Audio Files…','T','!Freestyle has no region-to-file conversion.'],[583,'⇧W','Open in External Sample Editor','T','!A browser cannot open an external sample editor.'],[584,'⌃⇧T','Move Selected Regions to Focused Track','T','=move-to-selected-track'],[129,'⌥⇧⌘R','Move Region to Recorded Position','T','!Freestyle keeps no recorded timestamp on regions.'],
 [1711,'⌥⌘L','Time Stretch Region Length to Locators','T','!Freestyle has no region time stretch.'],[1712,'⌥⌘B','Time Stretch Region Length to Nearest Bar','T','!Freestyle has no region time stretch.'],[2344,'⌃⌥G','Normalize Region Gain…','T','!Set region gain in the Region inspector; there is no normalise analysis.'],[2350,'⌃G','Apply Normalize Region Gain Again','T','!Set region gain in the Region inspector; there is no normalise analysis.'],
 [1345,'⌥⇧X','Apply Last Edited Fade Again','T','!Edit fades with the Fade tool or in the Region inspector.'],[1349,'⌃⌥X','Apply Default Crossfade','T','!Freestyle has no crossfades between regions.'],[564,'⌥X','Audio Crossfade Options for Merge…','T','!Freestyle has no crossfades between regions.'],
 [1733,'⌃⌘X','Cut Section Between Locators (Global)','T','!'+NO.section],[1734,'⌃⌘I','Insert Silence Between Locators (Global)','T','!'+NO.section],[1735,'⌃⌘V','Insert Section at Playhead (Global)','T','!'+NO.section],[1736,'⌃⌘R','Repeat Section Between Locators (Global)','T','!'+NO.section],
 [1750,'⌃D','Drum Replacement/Doubling','T','!Freestyle has no drum replacement.'],[1757,'⌃E','Convert Regions to New Sampler Track…','T','!Use the region menu ▸ Add to Step Sequencer.'],[1761,'⌃⇧[','Trim Region Start to Previous Transient','T','!'+NO.transient],[1762,'⌃⇧]','Trim Region Start to Next Transient','T','!'+NO.transient],[1763,'⌃[','Trim Region End to Previous Transient','T','!'+NO.transient],[1764,'⌃]','Trim Region End to Next Transient','T','!'+NO.transient],
 [119,'⌥[','Shuffle Left','T','!Freestyle has no shuffle edit.'],[1770,'⌥]','Shuffle Right','T','!Freestyle has no shuffle edit.'],[361,'⌘PgUp','Unlock SMPTE Position','T','!'+NO.smpte],[362,'⌘PgDn','Lock SMPTE Position','T','!'+NO.smpte],
 [1799,'⇧N','Rename Regions','T','=rename-region'],[578,'⌥⇧N','Name Regions by Track Name','T','=name-regions-by-track'],[560,'⌥⇧C','Color Regions by Track Color','T','!'+NO.colour],[1789,'⌥⇧⌘N','Name Tracks by Region Name','T','=name-track-by-region'],[1790,'⌥⇧⌘C','Color Tracks by Region Color','T','!'+NO.colour],
 [607,'⌃⇧Space','Play/Stop Region','T','=play-from-selection'],[1333,'⌃⇧R','Reverse On/Off','T','!Freestyle has no reverse playback for regions.'],[2273,'⌃F','Flex On/Off','T','!'+NO.flex],
 // ── Selection
 [354,'←','Select Previous Region/Event','T','=select-region:-1'],[355,'→','Select Next Region/Event','T','=select-region:1'],[356,'⇧←','Toggle Previous Region/Event','T','=extend-region:-1'],[357,'⇧→','Toggle Next Region/Event','T','=extend-region:1'],
 [354,'←','Select Previous Region/Event','P','~'],[355,'→','Select Next Region/Event','P','~'],[356,'⇧←','Toggle Previous Region/Event','P','=extend-note:-1'],[357,'⇧→','Toggle Next Region/Event','P','=extend-note:1'],
 [1272,'↑','Select Previous Track','T','=select-track:-1'],[1273,'↓','Select Next Track','T','=select-track:1'],[1785,'⇧↑','Extend Track Selection Up','T','!One track is selected at a time.'],[1786,'⇧↓','Extend Track Selection Down','T','!One track is selected at a time.'],
 [347,'⇧D','Deselect All','TP','=deselect-all'],[340,'⇧I','Invert Selection','TP','=invert-selection'],[346,'⇧F','Select All Following','TP','=select-following'],[1506,'⌃⇧F','Select All Following of Same Track/Pitch','TP','=select-following:same'],[341,'⇧L','Select All Inside Locators','TP','=select-inside-locators'],
 [587,'⇧M','Select Muted Regions/Events','TP','=select-muted'],[343,'⇧O','Select Overlapped Regions/Events','TP','=select-overlapped'],[344,'⇧S','Select Similar Regions/Events','TP','=select-equal'],[345,'⇧E','Select Equal Regions/Events','TP','=select-equal'],[588,'⇧C','Select Same-Colored Regions/Events','TP','!'+NO.colour],
 [363,'⇧H','Select Same Channels','P','!Notes carry no separate MIDI channel in Freestyle patterns.'],[399,'⇧P','Select Same Subpositions','P','=select-same-subposition'],[2502,'⇧A','Select Same Articulation','P','!Freestyle notes have no articulation IDs.'],
 [348,'⇧Home','Select First','TP','=select-edge:first'],[349,'⇧End','Select Last','TP','=select-edge:last'],[320,'⇧↑','Select Highest Notes','P','=select-pitch-edge:high'],[321,'⇧↓','Select Lowest Notes','P','=select-pitch-edge:low'],
 // ── Piano Roll
 [110,'Q','Quantize Selected Events','P','=quantize'],[110,'Q','Quantize Selected Events','T','!Open the region in the Piano Roll (P) and press Q.'],[381,'⌥⌘Q','Dequantize','TP','!Quantize rewrites note positions; use Undo (⌘Z) to get them back.'],
 [311,'\\','Trim Note End to Remove Overlaps to Following Notes','P','=note-overlap-correction'],[312,'⇧\\','Trim Note End to Following Notes (Force Legato)','P','=note-legato'],
 [53,'⌥O','Toggle MIDI Out (Note Preview)','P','=toggle-midi-out'],[72,'⌥I','Toggle MIDI In (Step Record)','P','!Step input is not available; record notes with R and Musical Typing (⌘K).'],
 [2269,'⌃T','Toggle Time Handles','P','!There are no time handles; drag note edges or use Edit ▸ Transform.'],[2277,'⌃⇧B','Define Brush Pattern and Set Brush Tool','P','!There is no Brush tool.'],[2278,'⌃⇧Delete','Reset Brush Pattern','P','!There is no Brush tool.'],
 // ── Tracks
 [1715,'⌥⌘N','New Tracks…','G','=new-tracks'],[1795,'⌥⌘A','New Audio Track','G','=new-audio-track'],[1796,'⌥⌘S','New Software Instrument Track','G','=new-instrument-track'],[1797,'⌥⌘P','New Session Player Track…','G','!Freestyle has no session players.'],[1798,'⌥⌘X','New External MIDI Track','G','!A browser has no external MIDI outputs for Freestyle tracks.'],
 [1728,'⌘D','New Track with Duplicate Settings','TM','=duplicate-track'],[2351,'⌥⇧⌘D','New Track with Duplicate Settings and Content','TM','=duplicate-track-content'],[581,'⌃Return','New Track with Next Channel / Instrument','T','!Every Freestyle track has its own channel strip; use ⌘D.'],[87,'⌃⇧Return','New Track with Same Channel Strip/Instrument','T','!Every Freestyle track has its own channel strip; use ⌘D.'],
 [88,'⌘Delete','Delete Track','T','=delete-track'],[89,'⇧⌘Delete','Delete unused Tracks','T','=delete-unused-tracks'],[571,'⇧Return','Rename Track','TM','=rename-track'],[1744,'⌥T','Configure Track Header…','T','!Track headers always show number, icon, name, M S R I, volume and pan.'],[1600,'⌃⌘T','Search and Select Track…','T','!There is no track search; click a track header.'],
 [1231,'M','Toggle Channel Strip Mute','G','=mute-track'],[1232,'S','Toggle Channel Strip Solo','G','=solo-track'],[1041,'⌃⇧M','Mute off for all','TM','=unmute-all'],[1040,'⌥S','Clear/Recall Solo','TM','=clear-solo'],[566,'⌥M','Toggle Track On','T','!Freestyle tracks cannot be switched off; mute them (M).'],
 [593,'⌃R','Toggle Track Record Enable','T','!Freestyle records on the selected track from the control bar Record button (R).'],[1234,'⌃I','Toggle Channel Strip Input Monitoring','TM','!Input monitoring is not available for cloud tracks.'],[117,'⌃H','Hide/Show Selected Tracks','T','!'+NO.hide],[118,'⌃⇧H','Unhide All Tracks','T','!'+NO.hide],[1337,'⌃⌥⇧A','Toggle Activation of All Tracks','T','!Freestyle tracks cannot be switched off; mute them (M).'],
 [1791,'⇧⌘D','Create Track Stack…','T','!'+NO.stack],[1792,'⇧⌘H','Create Folder Stack','T','!'+NO.stack],[1793,'⇧⌘G','Create Summing Stack','T','!'+NO.stack],[1794,'⇧⌘U','Flatten Stack','T','!'+NO.stack],[2274,'⌃⌘→','Open Track Stack','T','!'+NO.stack],[2275,'⌃⌘←','Close Track Stack','T','!'+NO.stack],[84,'⌃⌥⇧F','Pack Folder','T','!'+NO.stack],
 [2345,'⌃⌥⌘N','New Track Alternative','T','!'+NO.alt],[2346,'⌃⌥⌘D','Duplicate Track Alternative','T','!'+NO.alt],[2349,'⌃⌥⌘FwdDel','Delete Inactive Track Alternatives','T','!'+NO.alt],[2354,'⌃⌥A','Show/Hide Inactive Track Alternatives','T','!'+NO.alt],[2357,'⌃⌥⌘Return','Rename Track Alternative','T','!'+NO.alt],[2366,'⌃⌥↑','Activate Next Track Alternative','T','!'+NO.alt],[2367,'⌃⌥↓','Activate Previous Track Alternative','T','!'+NO.alt],
 [85,'⌃⇧⌘U','Unpack Take Folder to New Tracks','T','!'+NO.take],[1717,'⌃⌘U','Unpack Take Folder to Existing Tracks','T','!'+NO.take],[1729,'⌃⌥⌘F','Pack Take Folder','T','!'+NO.take],[1737,'⌥F','Un/disclose Take Folder','T','!'+NO.take],[1738,'⌥⇧U','Flatten Take Folder','T','!'+NO.take],[1739,'⌥U','Flatten and Merge Take Folder','T','!'+NO.take],[1740,'⇧T','Rename Take or Comp','T','!'+NO.take],[1741,'⌥⇧Delete','Delete Take or Comp','T','!'+NO.take],[1745,'⌥Q','Toggle Take Folder Quick Swipe Comping Mode','T','!'+NO.take],[1754,'⇧⌘↑','Select Previous Take or Comp','T','!'+NO.take],[1755,'⇧⌘↓','Select Next Take or Comp','T','!'+NO.take],
 [883,'⌥G','Configure Global Tracks…','T','!'+NO.global],[887,'⇧⌘O','Show/Hide Movie Track','T','!'+NO.movie],[888,'⇧⌘K','Show/Hide Marker Track','T','!'+NO.global],[895,'⇧⌘T','Show/Hide Tempo Track','T','^!'+NO.global],[896,'⇧⌘C','Show/Hide Chord Track','T','!'+NO.global],[897,'⇧⌘B','Show/Hide Beat Mapping Track','T','!'+NO.global],[899,'⇧⌘A','Show/Hide Arrangement Track','T','!'+NO.global],[1775,'⇧⌘M','Show/Hide Master Track','T','!The master channel strip (Stereo Out) is in the Inspector and the Mixer.'],
 [327,'⌃⌥⇧T','Create Time Signature Change','G','=tempo-list'],[328,'⌃⌥⇧K','Create Key Signature Change','G','!Freestyle keeps one project key (Freestyle ▸ Analyze Key…).'],
 // ── Mix / automation / plug-ins
 [1216,'⌥⌘C','Copy Channel Strip Setting','G','=copy-channel-strip'],[1217,'⌥⌘V','Paste Channel Strip Setting','G','=paste-channel-strip'],[1214,'⇧]','Next Channel Strip Setting of focused Track','G','!'+NO.strip],[1215,'⇧[','Previous Channel Strip Setting of focused Track','G','!'+NO.strip],
 [1212,']','Next Patch, Plug-in Setting or Sampler Instrument','G','=plugin-preset:1'],[1213,'[','Previous Patch, Plug-in Setting or Sampler Instrument','G','=plugin-preset:-1'],[1249,'⌃⌘P','Search and Add Plug-in…','G','=add-plugin'],[2527,'⌃⌘Z','Plug-in Undo','G','!Plug-in parameter changes are part of the project Undo (⌘Z).'],[2528,'⌃⇧⌘Z','Plug-in Redo','G','!Plug-in parameter changes are part of the project Redo (⇧⌘Z).'],
 [1012,'⌃⌘O','Toggle Selected Tracks Automation Off/Read','G','!'+NO.auto],[1015,'⌃⌘A','Toggle Selected Tracks Automation Latch/Read','G','!'+NO.auto],[1019,'⌃⇧⌘O','Set All Tracks to Automation Off','G','!'+NO.auto],[1020,'⌃⇧⌘R','Set All Tracks to Automation Read','G','!'+NO.auto],[1021,'⌃⇧⌘T','Set All Tracks to Automation Touch','G','!'+NO.auto],[1022,'⌃⇧⌘L','Set All Tracks to Automation Latch','G','!'+NO.auto],
 [1030,'⌃⌥⌘A','Automation Quick Access','G','!There is no hardware controller quick access.'],[1032,'⌃⌘E','Track Automation Event List…','G','!'+NO.list],[1158,'⌥A','Open Automation Settings…','G','!There are no automation settings; open Track Automation (A).'],
 [1037,'⌃⌘Delete','Delete Visible Automation on Selected Tracks','T','!Delete automation points in the track’s automation lane (A).'],[1038,'⌃⇧⌘Delete','Delete All Automation on Selected Tracks','T','!Delete automation points in the track’s automation lane (A).'],[1193,'⌃⇧Delete','Delete Orphaned Automation on Selected Tracks','T','!Freestyle keeps no orphaned automation.'],[1256,'⌃Delete','Delete Redundant Automation Points','T','!Delete automation points in the track’s automation lane (A).'],
 [1043,'⌃⌘↑','Move Visible Region Data to Track Automation','T','!Freestyle has one automation kind per target; nothing to convert.'],[1044,'⌃⌘↓','Move Visible Track Automation to Region','T','!Freestyle has one automation kind per target; nothing to convert.'],[1045,'⌃⇧⌘↑','Move All Region Data to Track Automation','T','!Freestyle has one automation kind per target; nothing to convert.'],[1046,'⌃⇧⌘↓','Move All Track Automation to Region','T','!Freestyle has one automation kind per target; nothing to convert.'],
 [1258,'⌃⇧⌘1','Create 1 Track Automation Point at Region Borders','T','!Add automation points in the track’s automation lane (A).'],[1259,'⌃⇧⌘2','Create 2 Track Automation Points at Region Borders','T','!Add automation points in the track’s automation lane (A).'],[1301,'⌃⌘1','Create 1 Track Automation Point at Every Region Border','T','!Add automation points in the track’s automation lane (A).'],[1302,'⌃⌘2','Create 2 Track Automation Points at Every Region Border','T','!Add automation points in the track’s automation lane (A).'],
 [1031,'⇧G','Enable/Disable Groups','G','!'+NO.group],[1800,'⌃G','Create Group…','M','!'+NO.group],[2370,'⌃⌘G','Create Group for Selected Channel Strips / Tracks','G','!'+NO.group],
 [1776,'⌃⇧1','Toggle Hide Group 1','G','!'+NO.group],[1777,'⌃⇧2','Toggle Hide Group 2','G','!'+NO.group],[1778,'⌃⇧3','Toggle Hide Group 3','G','!'+NO.group],[1779,'⌃⇧4','Toggle Hide Group 4','G','!'+NO.group],[1780,'⌃⇧5','Toggle Hide Group 5','G','!'+NO.group],[1781,'⌃⇧6','Toggle Hide Group 6','G','!'+NO.group],[1782,'⌃⇧7','Toggle Hide Group 7','G','!'+NO.group],[1783,'⌃⇧8','Toggle Hide Group 8','G','!'+NO.group],[1784,'⌃⇧9','Toggle Hide Group 9','G','!'+NO.group],
 [3048,'⌥⇧K','Open Controller Assignments','G','!There are no control surface assignments.'],[3096,'⌘L','Learn new Controller Assignment','G','^!There are no control surface assignments.'],
 [1318,'⌃⌥Return','Note Repeat','G','!Note Repeat is not available.'],[1319,'⌃⌥Delete','Spot Erase','G','!Spot Erase is not available.'],[2681,'⌥⇧Space','Preview Selection-Based Processing','G','!There is no selection-based processing.'],
 // ── Mixer
 [2007,'⇧X','Cycle Through Mixer Modes (Single, Tracks, All)','M','=mixer-mode'],[2008,'⌃N','Create New Auxiliary Channel Strip','M','=create-bus'],[2017,'⌃T','Create Tracks for Selected Channel Strips','M','!Every Freestyle channel strip already has its track.'],
 [2052,'←','Select Previous (Left) Channel Strip','M','=select-strip:-1'],[2053,'→','Select Next (Right) Channel Strip','M','=select-strip:1'],
 [2010,'⇧A','Select Audio Channel Strips','M','=select-strips:audio'],[2011,'⇧S','Select Instrument Channel Strips','M','=select-strips:instrument'],[2012,'⇧F','Select Auxiliary Channel Strips','M','=select-strips:bus'],[2013,'⇧O','Select Output Channel Strips','M','=select-strips:master'],[2014,'⇧E','Select MIDI Channel Strips','M','!There are no external MIDI channel strips.'],[2015,'⇧C','Select Same-Colored Channel Strips','M','!'+NO.colour],[2016,'⇧M','Select Muted Channel Strips','M','=select-strips:muted'],
 [1235,'⌃⇧S','Toggle Channel Strip Format (mono/stereo)','M','!Freestyle channel strips are stereo.'],[2069,'⌥X','Configure Channel Strip Components…','M','=mixer-view-menu'],[2079,'⌃⌥⌘S','Sends on Faders','M','!Sends on Faders is not available; set send levels in the Sends slots.'],
 [2050,'⌃⇧X','Show/Hide Track Number','M','!Channel strips always show their name; track numbers are in the Tracks area.'],[2061,'⌃⇧G','Show/Hide Grouping','M','!'+NO.group],[2063,'⌃⇧I','Show/Hide Track Icon','M','!Channel strips have no icons.'],[2067,'⌃⇧V','Show/Hide VCA','M','!Freestyle has no VCA faders.'],[2105,'⌃⇧L','Show/Hide Long Faders','M','!Drag the top edge of the Mixer to make the faders longer.'],[2106,'⌃⇧N','Show/Hide Notes','M','!Freestyle projects have no notes field.'],
 // ── Step Sequencer
 [2864,'⇧R','Live Record','S','!Record steps with R on the track; there is no separate Live Record.'],[2866,'⌃⇧⌘M','Mono Mode','S','!Rows are always polyphonic.'],[2867,'⇧Return','Rename Row','S','=step-rename-row'],
 [2872,'↑','Select Step Above','S','!Steps are switched with the pointer; there is no step cursor.'],[2873,'↓','Select Step Below','S','!Steps are switched with the pointer; there is no step cursor.'],[2874,'←','Select Previous Step','S','!Steps are switched with the pointer; there is no step cursor.'],[2875,'→','Select Next Step','S','!Steps are switched with the pointer; there is no step cursor.'],[2968,'\'','Toggle Selected Step','S','!Steps are switched with the pointer; there is no step cursor.'],
 [2877,'⌃C','Copy Row','S','=step-copy-row'],[2878,'⌃V','Paste Row','S','=step-paste-row'],[2879,'⌥⇧V','Paste Steps','S','=step-paste-row'],[2880,'⌃⌥⇧V','Paste Row Settings','S','!Row settings are not copied separately; Paste Row (⌃V) pastes the steps.'],[2881,'⌃⇧V','Paste to New Row','S','!Add a row with +, then Paste Row (⌃V).'],[2882,'⌘D','Duplicate Row with Next Assignment','S','!Rows are sounds, not notes of one instrument; add a row with +.'],
 [2883,'⌃Delete','Clear Step','S','!Click a lit step to clear it; there is no step cursor.'],[2884,'⌃⌘Delete','Clear Row','S','=step-clear-row'],[2885,'⌃⇧⌘Delete','Clear Pattern','S','=step-clear-pattern'],[2892,'⌘Delete','Delete Row','S','=step-delete-row'],[2966,'⇧⌘Delete','Delete Unused Rows','S','!Delete rows one at a time (⌘⌫).'],
 [2886,'⌥↑','Transpose +1 Semitone','S','!Step rows trigger sounds, not pitches; transpose notes in the Piano Roll.'],[2887,'⌥↓','Transpose -1 Semitone','S','!Step rows trigger sounds, not pitches; transpose notes in the Piano Roll.'],[2888,'⌥⇧↑','Transpose +1 Octave','S','!Step rows trigger sounds, not pitches; transpose notes in the Piano Roll.'],[2889,'⌥⇧↓','Transpose -1 Octave','S','!Step rows trigger sounds, not pitches; transpose notes in the Piano Roll.'],
 [2959,'⌥⌘→','Rotate Row Right','S','=step-rotate-row:1'],[2960,'⌥⌘←','Rotate Row Left','S','=step-rotate-row:-1'],[2951,'⌃⌥⌘→','Rotate Pattern Right','S','=step-rotate-pattern:1'],[2952,'⌃⌥⌘←','Rotate Pattern Left','S','=step-rotate-pattern:-1'],[2974,'⌥⇧→','Rotate Values for Current Edit Mode Right','S','=step-rotate-row:1'],[2975,'⌥⇧←','Rotate Values for Current Edit Mode Left','S','=step-rotate-row:-1'],
 [2953,'⌃⇧S','Solo Row','S','=step-solo-row'],[2954,'⌃⇧M','Mute Row','S','=step-mute-row'],
 [2977,'⌃⌥S','Set Global Edit Mode to Steps On/Off','S','=step-edit-mode:steps'],[2978,'⌃⌥V','Set Global Edit Mode to Velocity/Value','S','=step-edit-mode:velocity'],[2979,'⌃⌥G','Set Global Edit Mode to Gate','S','!'+NO.stepMode],[2980,'⌃⌥T','Set Global Edit Mode to Tie','S','!'+NO.stepMode],[2981,'⌃⌥N','Set Global Edit Mode to Note','S','!'+NO.stepMode],[2982,'⌃⌥O','Set Global Edit Mode to Octave','S','!'+NO.stepMode],[2983,'⌃⌥L','Set Global Edit Mode to Loop Start/End','S','!'+NO.stepMode],[2984,'⌃⌥R','Set Global Edit Mode to Note Repeat','S','!'+NO.stepMode],[2985,'⌃⌥C','Set Global Edit Mode to Chance','S','!'+NO.stepMode],[2986,'⌃⌥F','Set Global Edit Mode to Start Offset','S','!'+NO.stepMode],[2987,'⌃⌥A','Set Global Edit Mode to Step Rate','S','!'+NO.stepMode],[2988,'⌃⌥K','Set Global Edit Mode to Skip','S','!'+NO.stepMode],
 [2972,'⌥⌘Delete','Clear Current Edit Mode Values for Row','S','=step-clear-row'],[2976,'⌥`','Select Next Pattern Page','S','!The pattern is shown on one page; scroll sideways.'],
 [2991,'⌃⇧=','Increment Pattern Step Rate','S','!Freestyle step patterns use 1/16 steps only.'],[2992,'⌃⇧-','Decrement Pattern Step Rate','S','!Freestyle step patterns use 1/16 steps only.'],[2993,'⌃=','Increment Row Step Rate','S','!Freestyle step patterns use 1/16 steps only.'],[2994,'⌃-','Decrement Row Step Rate','S','!Freestyle step patterns use 1/16 steps only.'],
 [2955,'⌃]','Set Row Playback Mode to Forward','S','!'+NO.rowMode],[2956,'⌃[','Set Row Playback Mode to Reverse','S','!'+NO.rowMode],[2957,'⌃P','Set Row Playback Mode to Ping Pong','S','!'+NO.rowMode],[2958,'⌃\\','Set Row Playback Mode to Shuffle','S','!'+NO.rowMode],[2844,'⌃Y','Set Row Playback Mode to Pendulum','S','!'+NO.rowMode],[2845,'⌃U','Set Row Playback Mode to Wander','S','!'+NO.rowMode],[2846,'⌃J','Set Row Playback Mode to Random','S','!'+NO.rowMode],
 [2897,'⌃⌥]','Set Pattern Playback Mode to Forward','S','!'+NO.rowMode],[2898,'⌃⌥[','Set Pattern Playback Mode to Reverse','S','!'+NO.rowMode],[2899,'⌃⌥P','Set Pattern Playback Mode to Ping Pong','S','!'+NO.rowMode],[2950,'⌃⌥\\','Set Pattern Playback Mode to Shuffle','S','!'+NO.rowMode],[2847,'⌃⌥Y','Set Pattern Playback Mode to Pendulum','S','!'+NO.rowMode],[2848,'⌃⌥U','Set Pattern Playback Mode to Wander','S','!'+NO.rowMode],[2849,'⌃⌥J','Set Pattern Playback Mode to Random','S','!'+NO.rowMode],
 [2961,'⌃⌥=','Increment Loop Start for Row','S','!'+NO.loopRow],[2962,'⌃⌥-','Decrement Loop Start for Row','S','!'+NO.loopRow],[2963,'⌥⌘=','Increment Loop End for Row','S','!'+NO.loopRow],[2964,'⌥⌘-','Decrement Loop End for Row','S','!'+NO.loopRow],
 [2967,'⌃⌘→','Show Subrows for Row','S','=step-subrows:1'],[2969,'⌃⌘←','Hide Subrows for Row','S','=step-subrows:0'],[2970,'⌃⇧⌘→','Show Subrows for All Rows','S','=step-subrows:1'],[2971,'⌃⇧⌘←','Hide Subrows for All Rows','S','=step-subrows:0'],
 [2851,'⇧⌘P','Save Pattern','S','!Patterns are saved with the project (⌘S); there is no pattern library file.'],[2893,'⇧⌘T','Save Template','S','^!There are no Step Sequencer templates.'],[2857,'⌥⌘L','Learn (Add)','S','!Rows are added from the Browser or the + button, not by MIDI learn.'],[2858,'⌃⌥⌘D','Store as Default Pattern Template','S','!There are no Step Sequencer templates.'],[2859,'⌃⌥⇧D','Revert to Default Pattern Template','S','!There are no Step Sequencer templates.'],
 // ── Tool menu (T, then the key)
 [40,'T','Pointer Tool','X','=pick-tool:select'],[2324,'P','Pencil Tool','X','=pick-tool:draw'],[2320,'E','Eraser Tool','X','=pick-tool:erase'],[2322,'⇧T','Text Tool','X','=pick-tool:text'],[2318,'I','Scissors Tool','X','=pick-tool:slice'],[2319,'J','Join Tool','X','=pick-tool:glue'],[2323,'S','Solo Tool','X','=pick-tool:solo'],[2326,'M','Mute Tool','X','=pick-tool:mute'],[2329,'Y','Zoom Tool','X','=pick-tool:zoom'],[2335,'A','Fade Tool','X','=pick-tool:fade'],[2336,'U','Automation Select Tool','X','=pick-tool:automation'],[2337,'W','Automation Curve Tool','X','=pick-tool:automation-curve'],[2338,'R','Marquee Tool','X','=pick-tool:marquee'],[2339,'X','Flex Tool','X','=pick-tool:flex'],[2683,'G','Gain Tool','X','=pick-tool:gain'],[2327,'F','Finger Tool','X','=pick-tool:finger'],[2333,'V','Velocity Tool','X','=pick-tool:velocity'],[2334,'Q','Quantize Tool','X','=pick-tool:quantize'],[2340,'B','Brush Tool','X','=pick-tool:brush'],
];

const CODES={',':'Comma','.':'Period','/':'Slash',';':'Semicolon','\'':'Quote','[':'BracketLeft',']':'BracketRight','\\':'Backslash','`':'Backquote','-':'Minus','=':'Equal',Return:'Enter',Enter:'NumpadEnter',Delete:'Backspace',FwdDel:'Delete',Space:'Space',Tab:'Tab',Home:'Home',End:'End',PgUp:'PageUp',PgDn:'PageDown','←':'ArrowLeft','→':'ArrowRight','↑':'ArrowUp','↓':'ArrowDown',kpEnter:'NumpadEnter','kp.':'NumpadDecimal',kp0:'Numpad0','kp*':'NumpadMultiply','kp/':'NumpadDivide','kp=':'NumpadEqual'};
/** event.key → event.code for the unshifted punctuation keys (used only when an event carries no code). */
const KEY_CODES={',':'Comma','.':'Period','/':'Slash',';':'Semicolon','\'':'Quote','[':'BracketLeft',']':'BracketRight','\\':'Backslash','`':'Backquote','-':'Minus','=':'Equal','<':'Comma','>':'Period','?':'Slash'};
/** '⌥⌘N' → {ctrl,alt,shift,meta,code,label}. */
export function parseKeys(keys){
 let rest=String(keys);const mods={ctrl:false,alt:false,shift:false,meta:false};
 for(;;){const head=rest[0];if(head==='⌃'&&rest.length>1)mods.ctrl=true;else if(head==='⌥'&&rest.length>1)mods.alt=true;else if(head==='⇧'&&rest.length>1)mods.shift=true;else if(head==='⌘'&&rest.length>1)mods.meta=true;else break;rest=rest.slice(1);}
 const code=CODES[rest]||(/^[A-Z]$/.test(rest)?'Key'+rest:/^[0-9]$/.test(rest)?'Digit'+rest:rest);
 return{...mods,code,key:rest};
}
const signature=({ctrl,alt,shift,meta,code})=>`${ctrl?'c':''}${alt?'a':''}${shift?'s':''}${meta?'m':''}:${code}`;
export const LOGIC_KEY_COMMANDS=Object.freeze(ROWS.map(([id,keys,name,scope,action])=>{
 const reserved=action.startsWith('^'),body=reserved?action.slice(1):action,kind=body[0]==='='?'command':body[0]==='!'?'unavailable':'native';
 const [command,...args]=kind==='command'?body.slice(1).split(':'):[null];
 return Object.freeze({id,keys,name,scope,kind,command,args:Object.freeze(args),reason:kind==='unavailable'?body.slice(1):'',reserved,combo:Object.freeze(parseKeys(keys))});
}));
const INDEX=new Map();
for(const row of LOGIC_KEY_COMMANDS)for(const scope of row.scope){const key=scope+'|'+signature(row.combo);if(!INDEX.has(key))INDEX.set(key,row);}
/** Editor id (playlist | piano | rack | mixer | audio-editor | null) → scope letter. */
export const scopeForEditor=editor=>editor==='piano'?'P':editor==='rack'?'S':editor==='mixer'?'M':editor==='audio-editor'?'A':'T';
/** The key command row for a keydown in a scope ('X' while the tool menu is open), or null. */
export function matchKeyCommand(event,scope){
 if(!event)return null;
 let code=String(event.code||'');
 // Events without a physical code (assistive tools, synthetic keys) are matched by their key value.
 if(!code){const key=String(event.key||'');code=/^[a-z]$/i.test(key)?'Key'+key.toUpperCase():/^[0-9]$/.test(key)?'Digit'+key:key===' '||key==='Spacebar'?'Space':KEY_CODES[key]||key;}
 const sig=signature({ctrl:!!event.ctrlKey,alt:!!event.altKey,shift:!!event.shiftKey,meta:!!event.metaKey,code});
 return INDEX.get(scope+'|'+sig)||(scope==='X'?null:INDEX.get('G|'+sig))||null;
}
/** "Name (keys): reason" for a bound command that cannot run. */
export const unavailableMessage=row=>`${row.name} (${row.keys.replace(/^kp/,'keypad ')}): ${row.reason}`;
export const KEY_COMMAND_SCOPES=Object.freeze({G:'Global',T:'Tracks area',P:'Piano Roll',S:'Step Sequencer',M:'Mixer',X:'Tool menu'});
