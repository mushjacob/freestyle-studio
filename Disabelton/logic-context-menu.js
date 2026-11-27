/** Logic-style Tracks-area context menus (pure models for context-menu.js).
 *
 * Right-click (or a Mac Control-click) on a region opens the region menu and
 * on empty Tracks space the background menu, as in Logic Pro. Nothing here
 * erases on right-click; erasing is the Eraser tool or Delete. Every action is
 * one of the application's existing handlers; an item the cloud engine cannot
 * back stays visible and disabled with the reason as its tooltip.
 */

const BUSY='Wait for the current cloud operation to finish.';
/** Logic 11 Stem Splitter: Freestyle's stem separation is AI-assistant only (engine request C). */
export const STEM_SPLITTER_UNAVAILABLE='Stem Splitter: Freestyle separates stems only through its AI assistant (separate_stems / stem_status / replace_stem_part are “ai”-rated actions with undeclared arguments, and Studio Pro starts them only from the assistant). Waiting for a deterministic Studio API v1 operation.';

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
 * @param {object} options.run         handlers keyed by item id
 */
export function regionMenuItems({region,playhead=0,selection=1,muted=false,editable=true,canPaste=true,run={}}){
 const audio=!region?.patternId,busy=editable?null:BUSY,item=(id,label,shortcut,reason=null,extra={})=>({id,label,shortcut,run:run[id],disabled:!!reason||typeof run[id]!=='function',title:reason||'',...extra});
 const many=selection>1?` (${selection} regions)`:'';
 return[
  item('cut','Cut','⌘X',busy),
  item('copy','Copy','⌘C'),
  item('paste','Paste','⌘V',busy||(canPaste?null:'The clipboard is empty.')),
  item('delete','Delete'+many,'⌫',busy),
  null,
  item('split','Split at Playhead','⌘T',busy||(playheadInside(region,playhead)?null:'Move the playhead inside the region to split it.')),
  item('repeat','Repeat'+many,'⌘R',busy),
  item('mute',muted===true?'Unmute'+many:'Mute'+many,'⌃M',busy||(muted===null?'Reload the saved region mute before toggling it.':null),{checked:muted===true}),
  item('loop','Loop','L','Drag the region’s right edge to repeat it; Freestyle has no loop flag on regions.'),
  null,
  item('rename','Rename…','',busy||(audio?'Freestyle does not store names for audio regions.':null)),
  audio?item('sample-editor','Open in Audio File Editor','',busy):item('piano-roll','Open in Piano Roll','P'),
  audio?false:item('make-unique','Convert to Unique Pattern Region','',busy),
  null,
  audio?item('region-effect','Render Region Effect…','',busy):false,
  audio?item('stem-splitter','Stem Splitter…','',STEM_SPLITTER_UNAVAILABLE):false,
  audio?item('add-to-step-sequencer','Add to Step Sequencer','',busy):false,
  item('automation','Show Region Automation…','',busy),
  item('bounce','Bounce in Place…','','Freestyle renders regions in the cloud; use File ▸ Export for a bounce.'),
  audio?item('reload-waveform','Reload Waveform',''):false,
  audio?item('properties','Region Properties…','',busy):false
 ].filter(entry=>entry!==false).reduce(collapseSeparators,[]).filter((entry,index,list)=>entry!==null||index<list.length-1);
}

/** Why a MIDI / Pattern region cannot be created on this track (Logic: software instrument tracks only). */
const regionReason=kind=>kind==='audio'?'Audio tracks hold audio regions; create MIDI or Pattern regions on a software instrument track.':kind==='empty'||kind===null?'Right-click a software instrument track to create a region there.':null;

/** Empty Tracks-area menu (right-click on a track lane background). */
export function tracksBackgroundMenuItems({editable=true,canPaste=true,hasRegions=true,trackKind=null,run={}}){
 const busy=editable?null:BUSY,item=(id,label,shortcut,reason=null)=>({id,label,shortcut,run:run[id],disabled:!!reason||typeof run[id]!=='function',title:reason||''});
 return[
  item('paste','Paste','⌘V',busy||(canPaste?null:'The clipboard is empty.')),
  item('select-all','Select All','⌘A',hasRegions?null:'There are no regions to select.'),
  null,
  item('create-midi','Create MIDI Region','',busy||regionReason(trackKind)),
  item('create-pattern','Create Pattern Region','',busy||regionReason(trackKind)),
  null,
  item('new-tracks','New Tracks…','⌥⌘N',busy),
  item('import-audio','Add Audio File…','',busy),
  null,
  item('toggle-cycle','Cycle','C')
 ];
}
