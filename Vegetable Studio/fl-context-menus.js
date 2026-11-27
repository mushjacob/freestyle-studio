/** FL-ordered popup menus that the app renders with context-menu.js.
 *
 * Pure: every builder takes the commands it may run (`run.*`) and the state it
 * needs, and returns the item list in the order of the Image-Line manual
 * (mixer_mixermenu.htm, playlist.htm, menu_patterns.htm, channelrack.htm,
 * browser.htm). An entry without a Freestyle operation stays in its FL place,
 * disabled, with the reason as its tooltip; entries that FL does not have
 * follow in one trailing group. No DOM, no I/O.
 */
import {MENU_COLUMN} from './context-menu.js';
export const NOT_IN_FREESTYLE='Not available in Vegetable Studio.';
const item=(label,shortcut,run,reason=null)=>({label,shortcut:shortcut||'',run:typeof run==='function'?run:()=>{},disabled:!!reason||typeof run!=='function',title:reason||(typeof run==='function'?'':NOT_IN_FREESTYLE)});
const off=(label,shortcut='',reason=NOT_IN_FREESTYLE)=>item(label,shortcut,null,reason);
const check=(label,shortcut,checked,run,reason=null)=>({...item(label,shortcut,run,reason),checked:!!checked});
const sub=(label,submenu,reason=null)=>({label,shortcut:'',submenu,disabled:!!reason,title:reason||''});
const trailing=(items,extra)=>extra?.length?[...items,null,...extra]:items;

/** Mixer track right-click menu (mixer_mixermenu.htm ▸ "Mixer Track", Routing, Group, Layout). */
export function mixerTrackMenuItems({row={},run={},selectedCount=1,canSolo=true,canMove={left:false,right:false},extra=[]}={}){
 const master=row.kind==='master',lane=row.kind==='lane',noMaster=master?'The Master track cannot do this.':null,needLane=lane?null:'Freestyle keeps this for instrument, audio and vocal tracks only.';
 const audio='Freestyle tracks are already linked to their Playlist track.',state='Mixer track state files are not available in Freestyle.',editor='The audio editor is not available: use an audio clip ▸ Sample ▸ Edit sample.';
 const sidechain='Sidechain sends are not available: Freestyle sends are audible sends.',send='Keeping the Master output and adding a send: use the send switches at the bottom of the mixer track.',several=selectedCount>1?null:'Select other mixer tracks first (Ctrl+Shift+click).';
 return trailing([
  item('Rename, color and icon…','F2',run.rename,noMaster),
  off('Assign to new audio track(s)','',audio),off('Unassign from audio track(s)','',audio),
  sub('File',[off('Open mixer track state…','',state),off('Save mixer track state as…','Ctrl+Shift+S',state),off('Browse states','',state)]),
  off('Open audio editor','Ctrl+E',editor),off('Open audio editor and record','',editor),
  item('Reset selected track(s) to default','',run.reset,run.reset?noMaster:'Freestyle cannot clear a track’s effects, name and levels in one step: use ↺ (Reset channel levels) in the Mixer title bar and remove effects from their slots.'),
  null,
  sub('Routing',[
   sub('Channel routing',[item('Route selected channels to this track','Ctrl+L',run.routeChannels,needLane),item('Route selected channels starting from this track','Shift+Ctrl+L',run.routeChannelsFrom,needLane)]),
   sub('Track routing',[
    off('Route selected to this track','',send),
    item('Route selected to this track only','',run.routeSelectedHereOnly,several||(row.kind==='bus'?null:'Freestyle routes tracks to a bus: right-click a bus track.')),
    off('Sidechain selected to this track','',sidechain),off('Sidechain selected to this track only','',sidechain),
    item('Create submix…','',run.createSubmix,noMaster),
    null,
    off('Route this track to selected','',send),
    item('Route this track to selected only','',run.routeThisToSelectedOnly,needLane||several),
    off('Sidechain this track to selected','',sidechain),off('Sidechain this track to selected only','',sidechain)]),
   sub('Select',[
    item('Channels routed to this track','Alt+L',run.selectChannels),
    item('Channels and playlist tracks routed to this track','',run.selectChannelsAndTracks),
    item('Tracks this one is routed to','',run.selectTargets,noMaster),
    item('Tracks routed to this one','Ctrl+Alt+L',run.selectSources)]),
   item('Reset selected track(s) routing','',run.resetRouting,needLane)]),
  item('Solo','S',run.solo,canSolo?null:'This track cannot be soloed.'),
  item('Alt solo','Alt+S',run.altSolo,canSolo?null:'This track cannot be soloed.'),
  null,
  sub('Group',[off('Separator','','Mixer separators are not stored by Freestyle.'),off('Create group…','','Mixer track groups are not stored by Freestyle.'),off('Auto color group','','Mixer track colours are not stored by Freestyle.')]),
  sub('Layout',[
   sub('Dock to',[off('Left'),off('Middle'),off('Right')],'The Mixer has one dock: the Master sits on the left.'),
   item('Move left','Alt+Left',run.moveLeft,needLane||(canMove.left?null:'Already the first track.')),
   item('Move right','Alt+Right',run.moveRight,needLane||(canMove.right?null:'Already the last track.')),
   item('Delete','',run.delete,noMaster),
   sub('Insert',[item('One','',run.insert),off('Insert mixer tracks…','','Freestyle adds one track at a time.')]),
   sub('Trim unused tracks',[off('Unlinked tracks only'),off('Unlinked and non-empty tracks')],'Freestyle has no unused insert tracks: every mixer track is a project track or bus.')])
 ],extra);
}

/** Playlist main menu (playlist.htm ▸ "Playlist Menu"). `snap` = {options:[{value,label}],value,set}. */
export function playlistMainMenuItems({run={},state={},snap={options:[],value:null,set:null},extra=[]}={}){
 const none='Freestyle clips have no such setting.',render='Rendering clips to audio is not available: Freestyle has no bounce-in-place operation (use File ▸ Export).',view='The Playlist look follows the theme (Options ▸ Theme).',perf='Performance mode is not available in Freestyle.';
 const sizes=[33,50,66,100,150,200];
 return trailing([
  sub('Edit',[
   item('Cut','Ctrl+X',run.cut),item('Copy','Ctrl+C',run.copy),item('Paste','Ctrl+V',run.paste),item('Duplicate','Ctrl+B',run.duplicate),item('Delete','Del',run.delete),
   null,
   item('Shift left','Shift+Left',run.shiftLeft),item('Shift right','Shift+Right',run.shiftRight),item('Shift up','Shift+Up',run.shiftUp),item('Shift down','Shift+Down',run.shiftDown),
   null,
   check('Allow resizing from the left','Ctrl+Alt+Home',true,null,'Always on: drag a clip’s left edge.'),
   check('Nudge clips with mouse wheel','',false,null,none),
   check('Dropping on track header locks to content','',false,null,none),
   sub('Drop audio on track headers',[check('As audio clips','',true,null,'A file dropped on a track header always becomes an audio clip on that track.'),check('As audio tracks','',false,null,none),check('As instrument tracks','',false,null,none),check('Always ask','',false,null,none)]),
   null,
   item('Mute','Alt+M',run.mute),item('Unmute','Alt+Shift+M',run.unmute),
   null,
   item('Insert space','Ctrl+Ins',run.insertSpace),off('Slice and insert space','Ctrl+Alt+Ins','Use the Slice tool (C), then Insert space.'),item('Delete space','Ctrl+Del',run.deleteSpace),
   null,
   off('Merge pattern clips','Ctrl+G','Merging pattern clips is not available: Freestyle has no merge operation for placements.'),off('Merge similar pattern clips','Shift+Ctrl+G','Merging pattern clips is not available: Freestyle has no merge operation for placements.'),off('Merge automation clips','Ctrl+Alt+G','Merging automation clips is not available.'),
   null,
   off('Pitch selected audio clips one semitone down','7','Freestyle audio clips have no pitch setting.'),off('Pitch selected audio clips one semitone up','8','Freestyle audio clips have no pitch setting.'),off('Reverse selected audio clips','9','Freestyle audio clips have no reverse setting.'),
   null,
   check('Automatic crossfades','',false,null,none),check('Create new clips with manual fades','',false,null,none),check('Snap fade handles','',false,null,none),check('Create variants when stretching audio clips','',false,null,none),check('Select tracks when samples are dropped','',false,null,none)]),
  sub('Tools',[
   item('Quick quantize start times','Shift+Q',run.quickQuantize),
   sub('Consolidate playlist selection',[off('From selection start','Ctrl+Alt+C',render),off('From song start','Shift+Ctrl+Alt+C',render)]),
   sub('Export all playlist tracks',[off('From song start','',render),off('From track start','',render),off('Time selection','',render)]),
   sub('Export all playlist track groups',[off('From song start','',render),off('From track start','',render),off('Time selection','',render)]),
   off('Clone selected playlist track(s)','Shift+Ctrl+B','Cloning a track is not available from the Playlist: add a track and copy its clips.')]),
  sub('View',[
   off('Grid color…','Ctrl+Alt+G',view),sub('Grid contrast',[off('High','',view),off('Medium','',view),off('Low','',view)]),check('Invert grid','',false,null,view),check('Track separators','',true,null,'Track separators are always shown.'),
   sub('Time segments',[check('Bars','',true,null,'The Playlist background always shades bars.'),off('Beats','',view),off('Markers','',view)]),
   check('Keep labels on screen','',false,null,view),check('Content in title bars','',false,null,view),
   sub('Behind clips',['Nothing','Plain','Cel','Glass','Aqua','Solid'].map(name=>check(name,'',name==='Solid',null,view)).concat([check('Shadow','',false,null,view)])),
   sub('Resize all tracks',sizes.map(size=>check(`${size}%`,'',state.trackSize===size,run.resizeTracks?()=>run.resizeTracks(size):null))),
   check('Hide collapsed grouped tracks','',false,null,'Playlist track groups are not stored by Freestyle.'),
   check('Show fade previews','',true,null,'Fade previews are always drawn on audio clips.'),check('Show gain value','',false,null,view),check('Show gain scale','',false,null,view),check('Show gain previews','',false,null,view),
   check('Incremental scrolling','',false,null,view),check('Precise time indicator','',true,null,'The play position line is always drawn.'),
   check('Performance clip progress','',false,null,perf),check('Performance track progress','',false,null,perf),
   sub('Mini playlist preview',[check('Enable','',state.miniPreview!==false,run.toggleMiniPreview),check('Double height','',false,null,view),check('Show time markers','',false,null,view)]),
   check('Show controls on audio tracks','',false,null,'Recording controls live in the Mixer and the transport Record button.'),check('Show levels on audio tracks','',false,null,'Track levels are shown in the Mixer.'),check('Show levels on instrument tracks','',false,null,'Track levels are shown in the Mixer.'),
   off('Remove background picture','','The Playlist has no background picture.')]),
  sub('Snap',[check('Main','',true,null,'The Playlist always follows the global snap (toolbar Snap panel); pick its value below.'),null,...snap.options.map(option=>check(option.label,'',String(option.value)===String(snap.value),snap.set?()=>snap.set(option.value):null))]),
  sub('Select',[
   item('Deselect','Ctrl+D',run.deselect),item('Select all','Ctrl+A',run.selectAll),item('Select by selected source','Shift+C',run.selectBySource),item('Select muted','',run.selectMuted),item('Select overlapping clips','',run.selectOverlapping),item('Select stacked clips','',run.selectStacked),item('Invert selection','Shift+I',run.invertSelection),
   null,
   item('Select time around selection','Ctrl+Enter',run.selectTimeAround),item('Select previous time','Ctrl+Left',run.selectPreviousTime),item('Select next time','Ctrl+Right',run.selectNextTime)]),
  sub('Group',[item('Group','Shift+G',run.group),item('Ungroup','Alt+G',run.ungroup)]),
  sub('Zoom',[
   item('Zoom in','PgUp',run.zoomIn),item('Zoom out','PgDn',run.zoomOut),null,
   item('Quick zoom 1','Shift+1',run.zoomLevel?()=>run.zoomLevel(1):null),item('Quick zoom 2','Shift+2',run.zoomLevel?()=>run.zoomLevel(2):null),item('Quick zoom 3','Shift+3',run.zoomLevel?()=>run.zoomLevel(3):null),
   item('Zoom out far','Shift+4',run.zoomAll),item('Zoom on selection','Shift+5',run.zoomSelection),off('Zoom on performance clips','Shift+6',perf)]),
  sub('Time markers',[
   item('Add marker…','Alt+T',run.addMarker),item('Add auto','Ctrl+T',run.addAutoMarker),item('Add two','',run.addTwoMarkers),
   sub('Add one every',[['Bar',1],['2 bars',2],['4 bars',4],['8 bars',8]].map(([label,bars])=>item(label,'',run.addMarkersEvery?()=>run.addMarkersEvery(bars):null))),
   off('Add jump to next bar','','Jump markers are not available: Freestyle markers are labels.'),
   item('Add time signature change…','Shift+Alt+T',run.timeSignature),
   item('Place loop','Shift+T',run.placeLoop),
   item('Delete','',run.deleteMarkers),
   off('Change marker to loop','','Loop markers are not available: right-drag the ruler to set the song loop.'),
   off('Start recording at selection','','Recording markers are not available.'),off('Stop recording at selection','','Recording markers are not available.')]),
  null,
  check('Picker panel','Alt+P',state.pickerPanel!==false,run.togglePicker),
  check('Performance mode','Ctrl+P',false,null,perf),
  item('Center','Shift+0',run.center),
  check('Detached','',false,null,'Windows cannot be detached in the browser.')
 ],extra);
}

/** Playlist clip menu (playlist.htm ▸ "Clip Menus"). `kind` is 'pattern' or 'audio'. */
export function playlistClipMenuItems({kind='pattern',run={},sources=[],extra=[]}={}){
 const pattern=kind==='pattern',audioOnly=pattern?'This is a pattern clip.':null,patternOnly=pattern?null:'This is an audio clip.';
 const ai='Not available in Vegetable Studio.',chop='Chopping a clip into bars or beats is not available: use the Slice tool (C).';
 const items=[
  item('Preview','',run.preview,run.preview?null:'Isolated clip audition is not available: the Playback tool (Y) starts the song at the clip.'),
  sub(pattern?'Select source pattern':'Select source channel',sources.length?sources.map(source=>check(source.label,'',source.current,source.run,source.reason||null)):[off('(none)')],sources.length?null:'There is no other source to pick.'),
  ...(pattern?[item('Edit pattern','',run.editPattern)]:[item('Channel settings','',run.channelSettings)]),
  item('Rename and recolor…','',run.rename,run.rename?null:(pattern?'A pattern clip is named after its pattern: rename the pattern (F2).':'An audio clip is named after its file.')),
  off('Change color…','','Clip colours are not stored by Freestyle.'),
  item('Make unique','',run.makeUnique,patternOnly),
  item('Select all similar clips','',run.selectSimilar),
  item('Delete','Del',run.delete),
  ...(pattern?[off('Use current time signature','','Patterns follow the project time signature (Options ▸ Tempo and time signatures).')]:[]),
  sub('Region',[off('Select region','','This clip has no named region.')]),
  sub('Chop',[off('Bar','',chop),off('Beat','',chop),off('Beat (random)','',chop)]),
  ...(pattern?[]:[sub('Sample',[
   off('Make unique as sample','','Freestyle keeps one stored file per audio clip.'),
   item('Edit sample','E',run.editSample),
   off('Pitch correct sample','P',ai),off('Time-warp sample','',ai),
   item('Extract stems from sample','',run.extractStems,run.extractStems?null:ai),
   off('Deverb','',ai),
   item('Detect tempo','',run.detectTempo,run.detectTempo?null:ai),
   item('Fit to tempo','',run.fitTempo,run.fitTempo?null:ai)])]),
  sub('Automate',[item('Volume','',run.automateVolume),item('Panning','',run.automatePan,run.automatePan?null:'Clip pan automation is not available: automate the track pan in the Mixer.'),off('Crossfade with','','Crossfade automation is not available.')],audioOnly&&!run.automateVolume?audioOnly:null)
 ];
 return trailing(items,extra);
}

/** Playlist track header right-click menu (playlist.htm ▸ "Playlist Track Header Right-Click Menu"). */
export function playlistTrackHeaderMenuItems({run={},reasons={},state={},extra=[]}={}){
 const mode='Freestyle tracks are already bound to their mixer track and instrument.',group='Playlist track groups are not stored by Freestyle.',render='Rendering a track to audio is not available: Freestyle has no bounce-in-place operation.';
 return trailing([
  item('Rename, color and icon…','F2',run.rename,reasons.rename||null),
  item('Auto name','',run.autoName,reasons.autoName||null),
  off('Auto name clips','','Clips are named after their pattern or file.'),
  off('Reset','','Freestyle tracks have no colour or icon to reset.'),
  null,
  sub('Track mode',[check('Unassigned','',false,null,mode),check('Audio track','',state.kind==='audio'||state.kind==='vocal',null,mode),check('Instrument track','',state.kind==='instrument',null,mode)]),
  null,
  off('Performance settings','','Performance mode is not available in Freestyle.'),
  sub('Size',[33,50,66,100,150,200].map(size=>check(`${size}%`,'',state.trackSize===size,run.resize?()=>run.resize(size):null)),run.resize?null:'Track height is set for all tracks.'),
  check('Lock to this size','',false,null,'All Playlist tracks share one height (Playlist menu ▸ View ▸ Resize all tracks).'),
  null,
  off('Group with above track','',group),off('Auto color group','',group),
  null,
  check('Lock to content','',false,null,'Not available in Vegetable Studio.'),
  off('Merge pattern clips','','Merging pattern clips is not available: Freestyle has no merge operation for placements.'),
  sub('Consolidate this track',[off('From track start','Ctrl+Alt+C',render),off('From song start','Ctrl+Alt+Shift+C',render)]),
  item('Mute all clips','',run.muteClips,reasons.clips||null),
  item('Unmute all clips','',run.unmuteClips,reasons.clips||null),
  null,
  item('Insert one','',run.insert,reasons.insert||null),
  item('Delete','',run.delete,reasons.delete||null),
  off('Clone…','','Cloning a track is not available from the Playlist: add a track and copy its clips.'),
  item('Move up','',run.moveUp,reasons.moveUp||null),
  item('Move down','',run.moveDown,reasons.moveDown||null)
 ],extra);
}

/** Pattern selector menu (menu_patterns.htm ▸ "Pattern selector"). */
export function patternSelectorMenuItems({run={},reasons={},extra=[]}={}){
 const render='Rendering a pattern to an audio clip is not available: Freestyle has no bounce-in-place operation (use File ▸ Export).';
 // Order, separators, names and shortcuts of the reference Patterns menu (menu bar capture, 2026-11-17).
 const color='Pattern colours are not stored by Freestyle.',groups='Pattern groups are not stored by Freestyle.',order='Freestyle keeps patterns in creation order.';
 return trailing([
  item('Find first empty...','⇧F4',run.findFirstEmpty),
  item('Find next empty...','F4',run.findNextEmpty),
  item('Find next empty (no naming)','⌘F4',run.findNextEmptyNoNaming),
  null,
  item('Select in playlist','',run.selectInPlaylist),
  item('Rename and color...','F2',run.rename),
  off('Change color...','',color),
  off('Random color','',color),
  item('Open in project browser','⇧⌘P',run.openInBrowser),
  off('Group selected...','',groups),off('Rename group...','',groups),off('Ungroup selected...','',groups),
  item('Set time signature...','',run.timeSignature),
  item('Transpose...','',run.transpose),
  null,
  item('Insert one','',run.insert),
  item('Clone','⇧⌘C',run.clone),
  item('Delete','⇧⌘⌫',run.delete,reasons.delete||null),
  null,
  off('Move up','',order),
  off('Move down','',order),
  null,
  item('Split by channel','',run.splitByChannel),
  off('Quick render as audio clip','',render),off('Render as audio clip...','',render),off('Render and replace...','',render)
 ],extra);
}

/** Channel rack ▸ menu ("Channel Options Menu", channelrack.htm). `addOne` is the Add one submenu. */
export function channelRackMenuItems({run={},addOne=[],state={},reasons={},extra=[]}={}){
 const sel=reasons.selection||null,audio='Freestyle stretches audio clips in the cloud: there are no per-channel stretch modes.';
 return trailing([
  sub('Add one',addOne),
  off('Loop Starter','','Loop Starter is not available in Vegetable Studio.'),
  item('Select unused channels','',run.selectUnused),
  item('Clone selected','Alt+C',run.clone,sel),
  item('Delete selected…','Alt+Del',run.delete,sel),
  item('Move selected up','Alt+Up',run.moveUp,sel),
  item('Move selected down','Alt+Down',run.moveDown,sel),
  sub('Sort by',[off('Color'),off('Name'),off('Track number'),off('Type')],'Channel order is the order saved by Freestyle: use Move selected up / down.'),
  off('Group selected…','Alt+G','Channel groups are not stored by Freestyle.'),
  sub('Color selected',[off('Gradient…'),item('Random','',run.randomColor,sel)]),
  null,
  item('Mute selected','',run.mute,sel),
  item('Unmute selected','',run.unmute,sel),
  item('Transpose selected…','',run.transpose,sel),
  sub('Set swing mix for selected',[0,25,50,75,100].map(value=>off(`${value}%`)).concat([off('Custom…')]),'Swing is set for the whole pattern with the Swing knob.'),
  sub('Set truncate swing notes for selected',[off('On'),off('Off')],'Swing is set for the whole pattern with the Swing knob.'),
  item('Assign selected to free mixer track(s)','Ctrl+L',run.assignMixer,sel),
  sub('Change declicking for selected channels to',[off('(none)')],'Declicking modes are not available in Freestyle.'),
  MENU_COLUMN,/* FL's long Channel Options menu continues in a second column */
  item('Zip selected','Alt+Z',run.zip),
  item('Unzip all','Alt+U',run.unzipAll),
  off('Restretch all','Ctrl+Alt+R',audio),
  check('Group playlist tracks created by Loop starter','',false,null,'Loop Starter is not available in Vegetable Studio.'),
  null,
  sub('Auto resize',[check('Off','',true,null,'The Channel rack keeps the height you set.'),off('Minimum height'),off('Maximum height')]),
  check('Auto switch display filter','',false,null,'The channel filter changes only when you pick it.'),
  sub('Channel button width',[100,200,300,400].map(width=>check(`${width}%`,'',width===100,null,'Channel buttons have one width.'))),
  sub('Channel name alignment',[check('Centered','',true,null,'Channel names are centred.'),off('Left')]),
  check('Focus selected channel on playback','',false,null,NOT_IN_FREESTYLE),
  check('Mute removed steps','',false,null,NOT_IN_FREESTYLE),
  check('Show mixer track selectors','Alt+M',state.mixerSelectors!==false,run.toggleMixerSelectors),
  check('Show complete piano roll preview','',true,null,'The preview always shows every note.'),
  check('Show a mute button on the piano roll preview','',false,null,NOT_IN_FREESTYLE),
  check('Detached','',false,null,'Windows cannot be detached in the browser.'),
  sub('Switch all audio clip channels to',[off('Realtime'),off('Elastique'),off('Special'),off('Legacy')],audio),
  sub('Switch selected audio clip channels to',[off('Realtime'),off('Elastique'),off('Special'),off('Legacy')],audio)
 ],extra);
}

/** Browser file right-click menu (browser.htm ▸ "File Menu"). */
export function browserItemMenuItems({run={},reasons={},state={},extra=[]}={}){
 const plugin='Not available in Vegetable Studio.',cloud='Cloud library files have no folder on this computer.';
 return trailing([
  item('Send to selected channel or focused plugin','',run.sendToChannel,reasons.sendToChannel||null),
  item('Open in new channel','',run.openInNewChannel,reasons.openInNewChannel||null),
  off('Add to plugin database (flag as favorite)','','This is a sound, not a plugin preset.'),
  off('Edit in audio editor','',plugin),off('Edit in pitch corrector','',plugin),off('Edit in time warper','',plugin),
  item('Open in new sampler channel','',run.openInNewChannel,reasons.openInNewChannel||null),
  off('Open in new granulizer channel','',plugin),off('Open in new slicer channel','',plugin),off('Open in new slice sampler channel','',plugin),
  null,
  off('Open parent folder','',cloud),off('Locate file','',cloud),off('Delete file…','','Cloud library sounds cannot be deleted from the Browser.'),
  null,
  check('Favorite','',!!state.favorite,run.favorite,reasons.favorite||null),
  sub('Tags',(state.tags||[]).length?state.tags.map(tag=>check(tag,'',true,null,'Tags come from the Freestyle library.')):[off('(none)')],(state.tags||[]).length?null:'This sound has no tags.'),
  off('Add a tag…','','Tags come from the Freestyle library and cannot be edited here.'),off('Edit tags…','','Tags come from the Freestyle library and cannot be edited here.')
 ],extra);
}

/** Labels of a menu in order, submenus indented by two spaces per level (for tests and reports). */
export function menuOutline(items,depth=0){
 const out=[];
 for(const entry of items){
  if(!entry){out.push('  '.repeat(depth)+'---');continue;}
  if(entry.column)continue;
  const label=Array.isArray(entry)?entry[0]:entry.label,disabled=Array.isArray(entry)?!!entry[3]:!!entry.disabled,nested=Array.isArray(entry)?null:entry.submenu;
  out.push('  '.repeat(depth)+label+(nested?' ▸':'')+(disabled?' [off]':''));
  if(nested)out.push(...menuOutline(nested,depth+1));
 }
 return out;
}
