/** Logic-style Tracks-area context menus (pure models for context-menu.js).
 *
 * Right-click (or a Mac Control-click) on a region opens the region menu and
 * on empty Tracks space the background menu, as in Logic Pro. Nothing here
 * erases on right-click; erasing is the Eraser tool or Delete. Every action is
 * one of the application's existing handlers; an item the cloud engine cannot
 * back stays visible and disabled with the reason as its tooltip.
 */

const BUSY='Wait for the current cloud operation to finish.';
/** Logic 11 Stem Splitter over splitClipStems / getStemJob / undoStemJob (Studio API 345, engine request C).
 * Shown disabled with this reason only without a Studio API (OAuth) project. */
export const STEM_SPLITTER_UNAVAILABLE='Stem Splitter needs a Studio API (OAuth) project: Freestyle splits stems with splitClipStems. Reload the project.';
export const STEM_SPLITTER_RUNNING='Wait for the current Stem Splitter job to finish.';

/** Drop leading and doubled separators (absent items leave gaps). */
const collapseSeparators=(list,entry)=>{if(entry===null&&(!list.length||list.at(-1)===null))return list;list.push(entry);return list;};

/** Is `beat` strictly inside the region (a split there leaves two pieces)? */
export function playheadInside(region,beat){
 const start=Number(region?.start),length=Number(region?.length),at=Number(beat);
 return Number.isFinite(start)&&Number.isFinite(length)&&Number.isFinite(at)&&at>start+1e-6&&at<start+length-1e-6;
}

/** Regions a Split at Playhead / Mute applies to: the selection, else the clicked region. */
export function targetRegions(regions,{selectedIds=new Set(),clickedId=null}={}){
 const selected=regions.filter(region=>selectedIds.has(region.id));
 if(selected.length&&(!clickedId||selectedIds.has(clickedId)))return selected;
 const clicked=regions.find(region=>region.id===clickedId);return clicked?[clicked]:selected;
}

/**
 * Region context menu.
 * @param {object} options
 * @param {object} options.region      clicked region ({id,start,length,patternId?,name})
 * @param {number} options.playhead    playhead beat
 * @param {number} options.selection   selected region count (after the click selected it)
 * @param {boolean|null} options.muted region mute (null = unknown)
 * @param {boolean} options.editable   cloud edits are possible now
 * @param {false|'running'|null} options.stemSplitter false = no Studio API project; 'running' = a job is running
 * @param {object} options.run         handlers keyed by item id
 */
export function regionMenuItems({region,playhead=0,selection=1,muted=false,editable=true,canPaste=true,stemSplitter=null,run={}}){
 const audio=!region?.patternId,busy=editable?null:BUSY,item=(id,label,shortcut,reason=null,extra={})=>({id,label,shortcut,run:run[id],disabled:!!reason||typeof run[id]!=='function',title:reason||'',...extra});
 const many=selection>1?` (${selection} regions)`:'';
 // A key command of the default set (run.command(name, args)); `off` is an entry Freestyle cannot do, kept in place with the reason.
 const command=(label,shortcut,name,args=[],reason=null)=>({id:'command:'+name+(args.length?':'+args.join(':'):''),label,shortcut,run:typeof run.command==='function'?()=>run.command(name,args):undefined,disabled:!!reason||typeof run.command!=='function',title:reason||''});
 const off=(label,title,shortcut='')=>({label,shortcut,disabled:true,title}),group=(label,submenu)=>({label,submenu:submenu.filter(entry=>entry!==false)});
 const NO={join:'Freestyle has no region join operation.',place:'Freestyle bounces the whole mix (File ▸ Bounce ▸ Project or Section…); bounce in place is not available.',colour:'Freestyle regions and tracks have no colour field.',smpte:'Freestyle has no SMPTE position lock.',folder:'Freestyle has no folders or take folders.',tempo:'Freestyle has no tempo detection from a region.',file:'Freestyle has no region-to-file conversion.',convert:'Freestyle has one automation kind per target; nothing to convert.'};
 // Reference order: clipboard, then the command groups (Select … Processing); entries the reference has no counterpart for come last.
 return[
  item('cut','Cut','⌘X',busy),
  item('copy','Copy','⌘C'),
  item('paste','Paste','⌘V',busy||(canPaste?null:'The clipboard is empty.')),
  item('delete','Delete'+many,'⌫',busy),
  null,
  group('Select',[command('All Following','⇧F','select-following'),command('All Following of Same Track','⌃⇧F','select-following',['same']),command('All Inside Locators','⇧L','select-inside-locators'),command('Overlapped Regions','⇧O','select-overlapped'),command('Muted Regions','⇧M','select-muted'),command('Equal Regions','⇧E','select-equal'),command('Similar Regions','⇧S','select-equal'),off('Same-Colored Regions',NO.colour,'⇧C'),null,command('Invert Selection','⇧I','invert-selection'),command('Deselect All','⇧D','deselect-all')]),
  group('Split',[item('split','Split at Playhead','⌘T',busy||(playheadInside(region,playhead)?null:'Move the playhead inside the region to split it.')),command('Split at Locators','⌥⌘T','split-at-locators',[],busy)]),
  group('Bounce and Join',[item('bounce','Bounce in Place…','⌃B',NO.place),off('Join',NO.join,'⌘J'),off('Join per Tracks',NO.join,'J')]),
  group('Convert',[audio?off('Convert to New Region(s)','Audio regions are already independent of each other.','⌥⌘R'):item('make-unique','Convert to New Region(s)','⌥⌘R',busy),off('Convert to New Audio File(s)…',NO.file,'⌥⌘F'),off('Convert to New Sampler Track…','Use Add to Step Sequencer (below) to put this audio on a step row.','⌃E'),off('Convert Loops to Regions','Freestyle regions have no loop flag.','⌃⌘L'),off('Convert to MIDI Region','Open a pattern region in the Piano Roll (P) to edit it as MIDI.','⌃⌥⌘M')]),
  group('Export',[off('Add to Loop Library…','The Browser lists Freestyle’s catalogue; regions cannot be added to it.','⌃⇧O'),off('Export as Audio File…','Freestyle bounces the whole mix; per-region export is not available.'),audio?off('Export as MIDI File…','Select MIDI or pattern regions to export MIDI.','⌥⌘E'):command('Export as MIDI File…','⌥⌘E','export-selection-midi')]),
  group('Name and Color',[item('rename','Rename Regions','⇧N',busy||(audio?'Freestyle does not store names for audio regions.':null)),command('Name Regions by Track Name','⌥⇧N','name-regions-by-track',[],busy),command('Name Tracks by Region Name','⌥⇧⌘N','name-track-by-region',[],busy),null,off('Show Colors',NO.colour,'⌥C'),off('Color Regions by Track Color',NO.colour,'⌥⇧C'),off('Color Tracks by Region Color',NO.colour,'⌥⇧⌘C')]),
  group('SMPTE Lock',[off('Lock SMPTE Position',NO.smpte,'⌘PgDn'),off('Unlock SMPTE Position',NO.smpte,'⌘PgUp')]),
  group('Automation',[off('Convert Visible Region Automation to Track Automation',NO.convert,'⌃⌘↑'),off('Convert All Region Automation to Track Automation',NO.convert,'⌃⇧⌘↑'),off('Delete Visible Region Automation','Delete automation points in the track’s automation lane (A).'),off('Delete All Region Automation','Delete automation points in the track’s automation lane (A).')]),
  audio?false:group('MIDI',[off('Set Optimal Region Sizes Rounded by Bar','Freestyle has no optimal region length command.','⌃\\'),command('Remove Overlaps','\\','remove-overlaps',[],busy),off('Separate by MIDI Channel','Notes carry no separate MIDI channel in Freestyle patterns.'),off('Separate by Note Pitch','Freestyle has no region split by pitch.'),off('Transform','Open the region in the Piano Roll (P): Functions ▸ MIDI Transform.')]),
  group('Folder',[off('Pack Folder',NO.folder,'⌃⌥⇧F'),off('Pack Take Folder',NO.folder,'⌃⌥⌘F'),off('Unpack Take Folder to Existing Tracks',NO.folder,'⌃⌘U'),off('Unpack Take Folder to New Tracks',NO.folder,'⌃⇧⌘U')]),
  group('Move',[command('Move to Playhead',';','move-to-playhead',[],busy),command('Move to Focused Track','⌃⇧T','move-to-selected-track',[],busy),command('Nudge Left','⌥←','nudge',['-1'],busy),command('Nudge Right','⌥→','nudge',['1'],busy),off('Move to Recorded Position','Freestyle keeps no recorded timestamp on regions.','⌥⇧⌘R'),off('Shuffle Left','Freestyle has no shuffle edit.','⌥['),off('Shuffle Right','Freestyle has no shuffle edit.','⌥]')]),
  group('Trim',[command('Trim Start to Playhead','⌘[','trim-to-playhead',['start'],busy),command('Trim End to Playhead','⌘]','trim-to-playhead',['end'],busy),command('Trim End to Next Region','⇧\\','trim-end-to-next',[],busy),audio?command('Remove Overlaps','\\','remove-overlaps',[],busy):false,command('Crop Outside Locators','⌘\\','crop-to-locators',[],busy),off('Trim to Fill within Locators','Freestyle has no fill-to-locators trim.','⌥\\')]),
  group('Tempo',[off('Adjust Tempo using Region Length and Locators',NO.tempo),off('Apply Region Tempo to Project Tempo',NO.tempo),off('Time Stretch Region Length to Locators','Freestyle has no region time stretch.','⌥⌘L'),off('Time Stretch Region Length to Nearest Bar','Freestyle has no region time stretch.','⌥⌘B')]),
  audio?group('Processing',[item('stem-splitter','Stem Splitter…','',busy||(stemSplitter===false?STEM_SPLITTER_UNAVAILABLE:stemSplitter==='running'?STEM_SPLITTER_RUNNING:null)),off('Normalize Region Gain…','Set region gain in Region Properties… (below); there is no normalise analysis.','⌃⌥G')]):false,
  null,
  // ── not entries of the reference region menu (kept last)
  item('repeat','Repeat'+many,'⌘R',busy),
  item('mute',muted===true?'Unmute'+many:'Mute'+many,'⌃M',busy||(muted===null?'Reload the saved region mute before toggling it.':null),{checked:muted===true}),
  item('loop','Loop','⌃L','Drag the region’s right edge to repeat it; Freestyle has no loop flag on regions.'),
  audio?item('sample-editor','Open in Audio File Editor','',busy):item('piano-roll','Open in Piano Roll','P'),
  audio?item('region-effect','Render Region Effect…','',busy):false,
  audio?item('add-to-step-sequencer','Add to Step Sequencer','',busy):false,
  item('automation','Show Region Automation…','',busy),
  audio?item('reload-waveform','Reload Waveform',''):false,
  audio?item('properties','Region Properties…','',busy):false
 ].filter(entry=>entry!==false).reduce(collapseSeparators,[]).filter((entry,index,list)=>entry!==null||index<list.length-1);
}
/** Every leaf entry of a menu model (submenus flattened), for lookups by id or label. */
export function flattenMenuItems(items){return(items||[]).flatMap(item=>item&&Array.isArray(item.submenu)?flattenMenuItems(item.submenu):item?[item]:[]);}

/** Why a MIDI / Pattern region cannot be created on this track (Logic: software instrument tracks only). */
const regionReason=kind=>kind==='audio'?'Audio tracks hold audio regions; create MIDI or Pattern regions on a software instrument track.':kind==='empty'||kind===null?'Right-click a software instrument track to create a region there.':null;

/**
 * Empty Tracks-area menu (right-click on a track lane background).
 * Source of the entries: the reference's Quick Help names for the Tracks-area shortcut menu (CMT_003 Add Audio File,
 * CMT_004 Create MIDI Region, CMT_013 Create Pattern Region, CMT_005 Create Session Player Region, CMT_008 New Audio Track,
 * CMT_009 New Software Instrument Track, CMT_014 New Session Player SI Track) and the Edit menu's Paste / Select entries.
 * Order: create, clipboard, selection, view, new track; entries the reference has no counterpart for come last.
 */
export function tracksBackgroundMenuItems({editable=true,canPaste=true,hasRegions=true,trackKind=null,run={}}){
 const busy=editable?null:BUSY,item=(id,label,shortcut,reason=null)=>({id,label,shortcut,run:run[id],disabled:!!reason||typeof run[id]!=='function',title:reason||''});
 const command=(label,shortcut,name,reason=null)=>({id:'command:'+name,label,shortcut,run:typeof run.command==='function'?()=>run.command(name,[]):undefined,disabled:!!reason||typeof run.command!=='function',title:reason||''});
 const off=(label,title,shortcut='')=>({label,shortcut,disabled:true,title}),none=hasRegions?null:'There are no regions to select.';
 return[
  item('create-midi','Create MIDI Region','',busy||regionReason(trackKind)),
  item('create-pattern','Create Pattern Region','',busy||regionReason(trackKind)),
  off('Create Session Player Region','Freestyle has no session players.'),
  item('import-audio','Add Audio File…','',busy),
  null,
  item('paste','Paste','⌘V',busy||(canPaste?null:'The clipboard is empty.')),
  off('Paste at Original Position','Paste (⌘V) pastes at the playhead; Freestyle keeps no original position on the clipboard.'),
  off('Paste Replace','Paste (⌘V) adds regions; Freestyle has no replacing paste.','⇧⌘V'),
  null,
  item('select-all','Select All','⌘A',none),
  off('Select Empty Regions','Freestyle has no empty-region search; an empty region shows no notes.','⇧U'),
  command('Select Overlapped Regions','⇧O','select-overlapped',none),
  command('Select Muted Regions','⇧M','select-muted',none),
  null,
  off('Scroll in Play','The Tracks area follows the playhead (Catch); the content does not scroll under a fixed playhead.'),
  null,
  item('new-audio','New Audio Track','⌥⌘A',busy),
  item('new-instrument','New Software Instrument Track','⌥⌘S',busy),
  off('New Session Player SI Track','Freestyle has no session players.'),
  null,
  // ── not entries of the reference menu (kept last)
  item('new-tracks','New Tracks…','⌥⌘N',busy),
  item('toggle-cycle','Cycle','C')
 ];
}

/**
 * Track-header menu (right-click a track header).
 * Source: the reference's Track menu (the captured menu bar: names, order and key commands of the track commands) and,
 * for the header-only entries, the names in its string table (Reassign Track, Track Header Components with On/Off, Mute,
 * Solo, Track Protect, Freeze, Record Enable, Input Monitoring, Volume, Pan/Send; Configure Track Header…). The header
 * menu itself is not in Quick Help, so the grouping follows the Track menu. Entries the reference has no counterpart
 * for (Insert Track Here, Move Track Up / Down, Mute / Solo Track) come last.
 * base: playlistTrackMenuItems(...) (the engine-backed states and refusal reasons by id); run: handlers by id.
 */
export function trackHeaderMenuItems({base=[],kind=null,editable=true,run={}}={}){
 const byId=new Map((base||[]).filter(Boolean).map(entry=>[entry.id,entry])),busy=editable?null:BUSY;
 const UNBACKED='Freestyle’s Studio API does not offer this for the project.';
 // An engine-backed entry: its state and refusal reason come from the base model (absent = the API route is missing).
 const backed=(id,label,shortcut,{from=id}={})=>{const source=byId.get(from),reason=source?source.reason||null:UNBACKED;return{id,label,shortcut,run:run[id],disabled:!!reason||!!source?.disabled||typeof run[id]!=='function',title:reason||''};};
 const item=(id,label,shortcut,reason=null)=>({id,label,shortcut,run:run[id],disabled:!!reason||typeof run[id]!=='function',title:reason||''});
 const off=(label,title,shortcut='')=>({label,shortcut,disabled:true,title}),shown=label=>({label,checked:true,disabled:true,title:'Always shown in the track header.'});
 const NO={stack:'Freestyle has no track stacks or folders.',channel:'Every Freestyle track has its own channel strip; use New Track With Duplicate Settings (⌘D).',hide:'Freestyle has no hidden tracks.',colour:'Freestyle tracks have no colour field.',player:'Freestyle has no session players.'};
 const mute=byId.get('mute'),solo=byId.get('solo');
 return[
  item('new-tracks','New Tracks…','⌥⌘N',busy),
  item('new-audio','New Audio Track','⌥⌘A',busy),
  item('new-instrument','New Software Instrument Track','⌥⌘S',busy),
  off('New Session Player SI Track…',NO.player,'⌥⌘P'),
  off('New External MIDI Track','A browser has no external MIDI outputs for Freestyle tracks.','⌥⌘X'),
  {label:'Other',submenu:[backed('duplicate','New Track With Duplicate Settings','⌘D'),backed('duplicate-track','New Track With Duplicate Settings and Content','⌥⇧⌘D'),off('New Track With Next Channel',NO.channel,'⌃↩'),off('New Track With Same Channel',NO.channel,'⌃⇧↩'),null,off('New Track For Overlapped Regions','Drag overlapped regions to another track.'),off('New Track For Selected Regions','Create a track (⌥⌘N), then Edit ▸ Move ▸ To Focused Track.')]},
  backed('rename','Rename Track','⇧↩'),
  null,
  backed('delete','Delete Track','⌘⌫'),
  item('delete-unused','Delete Unused Tracks','⇧⌘⌫',busy),
  null,
  off('Create Track Stack…',NO.stack,'⇧⌘D'),off('Flatten Stack',NO.stack,'⇧⌘U'),
  null,
  off('Track Alternatives','Freestyle has no track alternatives.'),
  null,
  off('Replace or Double Drum Track…','Freestyle has no drum replacement.','⌃D'),
  off('Convert Regions to New Sampler Track…','Use the region menu ▸ Add to Step Sequencer.','⌃E'),
  null,
  off('Hide Track',NO.hide,'⌃H'),
  null,
  off('Reassign Track','Every Freestyle track owns its channel strip; a track cannot be pointed at another strip.'),
  {label:'Track Header Components',submenu:[off('On/Off','Freestyle tracks cannot be switched off; use Mute (M).'),shown('Mute'),shown('Solo'),off('Track Protect','Freestyle has no track protection.'),off('Freeze','Freestyle renders in the cloud; there is no track freeze.'),{...shown('Record Enable'),...(kind==='instrument'?{title:'Always shown; a software instrument track records what is played when it is selected.'}:{})},shown('Input Monitoring'),shown('Volume'),shown('Pan/Send')]},
  off('Configure Track Header…','Track headers always show number, icon, name, M S R I, volume and pan.','⌥T'),
  null,
  off('Assign Track Color…',NO.colour),off('Assign Track Icon…','Track icons follow the track type.'),
  null,
  // ── not entries of the reference menu (kept last)
  backed('insert','Insert Track Here',''),
  backed('move-up','Move Track Up',''),backed('move-down','Move Track Down',''),
  ...(mute?[{id:'mute',label:mute.label,shortcut:mute.reason?'':'M',run:run.mute,disabled:!!mute.disabled||typeof run.mute!=='function',title:mute.reason||''}]:[]),
  ...(solo?[{id:'solo',label:solo.label,shortcut:solo.reason?'':'S',run:run.solo,disabled:!!solo.disabled||typeof run.solo!=='function',title:solo.reason||''}]:[])
 ];
}

/**
 * Step Sequencer row menu (right-click a row header).
 * Source: the reference's Quick Help names for the Step Sequencer menus, in their id order (SSM_002 Copy Row, SSM_003 Paste Row,
 * SSM_004 Paste Steps, SSM_005 Paste Row Settings, SSM_006 Paste to New Row, SSM_007 Duplicate Row with Next Assignment,
 * SSM_008 Delete Row, SSM_010 Clear Row, SSM_011 Clear Pattern, SSM_026…030 Transpose, SSM_031 Randomize, SSM_033 Clear Row
 * Values, SSM_038 Delete Unused Rows, SSM_039…044 Sort Rows); "Duplicate Row", "Rename Row" and "Rotate Row Left / Right"
 * are named in its string table. Row-scoped entries only.
 * state: {steps (the row has step cells), canPaste, duplicateReason, deleteReason}; run: handlers by id;
 * extras: the app's own entries (Freestyle features with no counterpart), appended last.
 */
export const STEP_ROW_NOT_STEPS='Step operations need a sample (step) row; edit this instrument row in the Piano Roll.';
export function stepRowMenuItems({state={},run={},extras=[],divider=null}={}){
 // state.inactive: why none of the row commands apply (a project instrument that is not a row of this pattern yet).
 const inactive=typeof state.inactive==='string'&&state.inactive?state.inactive:null,steps=inactive||(state.steps!==false?null:STEP_ROW_NOT_STEPS);
 const item=(id,label,shortcut,reason=null)=>{const why=inactive||reason||(typeof run[id]!=='function'?'Not available in Freestyle for this row.':'');return{id,label,shortcut,run:run[id],disabled:!!why,title:why};};
 const off=(label,title,shortcut='')=>({label,shortcut,disabled:true,title});
 const NO={settings:'Freestyle’s step clipboard holds a row’s steps; row settings are not copied.',pitch:'A Freestyle step row plays its sample at one pitch; transpose notes in the Piano Roll.',edit:'Freestyle step rows have one edit mode (step on/off, with velocity under Edit Step Velocity).',sort:'Freestyle keeps the rows in the order you add them; drag is not offered and there is no row sort.'};
 return[
  item('copy','Copy Row','⌘C'),
  item('paste','Paste Row','⌘V',state.canPaste===false?'The Freestyle step clipboard is empty: copy a row first.':null),
  off('Paste Steps','Paste Row (⌘V) pastes the copied steps into the selected rows in Freestyle.'),
  off('Paste Row Settings',NO.settings),
  off('Paste to New Row','Freestyle pastes steps into existing rows; add a row first (Insert, below).'),
  null,
  item('duplicate','Duplicate Row','',state.duplicateReason||null),
  off('Duplicate Row with Next Assignment','Freestyle rows are samples or instruments, not note assignments; use Duplicate Row.'),
  item('delete','Delete Row','',state.deleteReason||null),
  off('Delete Unused Rows','Freestyle has no unused-row clean-up; delete a row with Delete Row.'),
  null,
  item('clear','Clear Row','⌫',steps),
  off('Clear Pattern','Select every row (⌘A), then Clear Row: Freestyle clears the selected rows.'),
  off('Clear Row Values',NO.edit),
  null,
  item('rename','Rename Row',''),
  item('rotate-left','Rotate Row Left','⇧⌘←',steps),
  item('rotate-right','Rotate Row Right','⇧⌘→',steps),
  null,
  {label:'Transpose',submenu:[off('Transpose +1 Semitone',NO.pitch),off('Transpose -1 Semitone',NO.pitch),off('Transpose +1 Octave',NO.pitch),off('Transpose -1 Octave',NO.pitch),off('Transpose to Project Key',NO.pitch)]},
  off('Randomize Current Edit Mode for Selected Rows',NO.edit),
  {label:'Sort Rows',submenu:[off('By Type',NO.sort),off('By Type and Note',NO.sort),off('By Type and Name',NO.sort),null,off('Ascending',NO.sort),off('Descending',NO.sort)]},
  // ── not entries of the reference menu (kept last; `divider` separates them, e.g. a column break)
  ...(extras.length?[divider,...extras]:[])
 ];
}
