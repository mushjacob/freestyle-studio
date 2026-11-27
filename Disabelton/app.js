import './freestyle-standalone-host.js';
import {syncProjectStepPiano,projectStepPiano,isStepPianoNote} from './step-piano.js';
import {STUDIO_VIEWS,activeStudioView,embeddedInFreestyle,openFreestyleMozart,openFreestyleShare,switchStudioView} from './freestyle-host-actions.js';
import {CloudEngine} from './cloud-engine.js';
import {installLogicShell,logicShellHooks,logicTrackHeaderHtml} from './logic-shell.js';
import {installAblShell} from './abl-shell.js';
import {installRegionTools,RECORD_LANE_KINDS,MIDI_RECORD_LANE_KINDS} from './logic-region-tools.js';
import {studioRecordingHooks,AblMidiRecordTake} from './abl-record-input.js';
import {configureInstrumentPatches,listPublishedPatches,monitorPatchChannel} from './abl-dev-presets.js';
import {humanizeNotes,openHumanizeDialog} from './logic-midi-transform.js';
import {AudioImportHistoryController} from './cloud-audio-import-history.js';
import {LaneCreateHistoryController} from './cloud-lane-create-history.js';
import {restoreLaneLiveChain,fullEngineReload} from './abl-lane-restore.js';
import {patternPreviewDiagnostics} from './preview-clock.js';
// Logic labels MIDI 60 as C3; every Piano Roll label goes through this one name.
import {logicNoteName as flNoteName,logicVelocityColor,midiVelocity,LOGIC_TIME_QUANTIZE,timeQuantizeBeats,quantizeLogic,LOGIC_SCALES,LOGIC_SCALE_ROOTS,scaleQuantizeNotes,logicPositionReadout,LOGIC_PIANO_TOOLS,logicPianoTool,logicEffectiveTool,logicPianoContextMenu} from './logic-piano.js';
import {registerEditorsApi,editorForPattern,editorWindowId,editorKindForWindow,editorTabsMarkup,clampEditorHeight,defaultEditorHeight,EDITOR_HEIGHT} from './logic-editors.js';
import {LogicMusicalTyping,musicalTypingMarkup,typingCode} from './logic-typing.js';
import {installAblClipView} from './abl-clip-view.js';
import {installAblRecordInput} from './abl-record-input.js';
import {PianoNoteProperties} from './piano-note-properties.js';
import {RackStepGesture} from './rack-step-stroke.js';
import {RackGraphEditor,rackGraphSet} from './rack-graph-editor.js';
import {RackSelectorController} from './rack-selector-controller.js';
import {rackClipboardCommand,rackSourceBinding,copyRackScore,cutRackScore,pasteRackScore} from './rack-selection.js';
import {CloudRackClipboardWriter} from './cloud-rack-clipboard.js';
import {attachPatternSampleSource,attachPatternSource,serializeCloudPattern,serializeCloudPlacement,setLiveMixOverlay,clearLiveMixOverlays,normalizeCloudProject} from './cloud-session.js';
import {clonePatternForCreate,planChannelClone,applyChannelClone,removeChannelScore} from './rack-clone.js';
import {projectRackView} from './project-rack-view.js';
import {renderMenuHtml,bindMenu,menuKeyDown,MENU_COLUMN} from './context-menu.js';
import {LOGIC_TOOLS} from './logic-keys.js';
import {valueBox,VALUE_BOX_DRAG_PX} from './fl-value-box.js';
import {fillEachSteps,rotateSteps,advancedFillSteps,randomizeAdvancedFill,patternStepCount,rackRowLength,sameSteps,rackRotateCommand,wheelPoints,wheelStepAt,wheelRotation} from './rack-step-ops.js';
import {emptyRackSourceTemplate,emptyRackSource} from './rack-empty-score.js';
import {buildMixerModel,mixerRowKey} from './mixer-model.js';
import {CloudMixerState} from './cloud-mixer-state.js';
import {StudioApiMixer,mixChangesFromApply} from './studio-api-mixer.js';
import {MixRevisionTracker,isMixRevisionConflict,mixValuesEqual,MIX_CONFLICT_NOTICE} from './mix-revision.js';
import {MixerControlQueue} from './mixer-control-queue.js';
import {studioApiFeatureAvailability,assertStudioApiFeature} from './studio-api-features.js';
import {CloudLiveMixer} from './cloud-live-mixer.js';
import {CloudMasterGain} from './cloud-master-gain.js';
import {CloudLanePan} from './cloud-lane-pan.js';
import {TypedMixerActions} from './typed-mixer-action.js';
import {CloudMixerRouting} from './cloud-mixer-routing.js';
import {CloudMixerRoutingDialog} from './cloud-mixer-routing-dialog.js';
import {MixerStripView} from './mixer-strip-view.js';
import {liveLaneGainMessage,liveLaneToggleMessage,livePluginParameterMessage,liveControlKey} from './cloud-live-control.js';
import {readMixerStripMeter,paintMixerMeter,MIXER_METER_MAX_AGE_MS} from './mixer-meter-frame.js';
import {MeterBallistics} from './mixer-meter-ballistics.js';
import {logicFaderLevelScale,logicLevelText} from './logic-fader-scale.js';
import {decorateLogicStrips,splitLogicChain,logicEqPlugin,logicAutomationModeItems,logicPluginName,openLogicPluginMenu,LOGIC_INSTRUMENT_TYPES,channelStripSettingItems} from './logic-mixer.js';
import {automationHostCandidates,automationClipId,clipDurationSec,automationTargetKey} from './automation-ui.js';
import {mountAblPluginHeader} from './abl-dev-window.js';
import {AblAutomationView} from './abl-auto.js';
import {installAblDevices} from './abl-devices.js';
import {installAblEngineTools} from './abl-engine-tools.js';
import {ablTrackColor,ablPaletteColor} from './abl-session.js';
import {createAblTrackOps,createMainActivator,createNamedSave,saveDownloadState,saveWavFilename,ablLaneColors} from './abl-track-ops.js';
import {mountAblEqEight} from './abl-dev-eq.js';
import {LogicAutomationView,saveAutomationPointEdit,createAutomationEnvelope,firstClickPoints} from './logic-automation.js';
import {attachMixerPanKnob} from './mixer-pan-knob.js';
import {attachChannelLevelKnob} from './channel-level-knob.js';
import {mountMonitorVolumeControl} from './monitor-volume-control.js';
import {FileDropController} from './file-drop-controller.js';
import {CloudPatternSampleRegistration} from './cloud-pattern-sample-registration.js';
import {CloudPatternSampleUpload} from './cloud-pattern-sample-upload.js';
import {CloudSamplePlacement,LIBRARY_SOUND_MIME,parseLibrarySoundDrag,rackSampleDragPayload,playlistDropLane} from './cloud-sample-placement.js';
import {CloudLaneCreate} from './cloud-lane-create.js';
import {CloudEmptyInstrument} from './cloud-empty-instrument.js';
import {CloudLaneCreateDialog} from './cloud-lane-create-dialog.js';
import {handleStudioShortcut,studioShortcutBlocked,installTransportKeyGuard} from './studio-shortcuts.js';
import {countLabel,playlistCopiesSavedMessage,clipClipboardMessage,logicCopy} from './ui-copy.js';
import {TypingPianoAudition} from './typing-piano.js';
import {WebMidiInput} from './web-midi-input.js';
import {PlaylistCloneController,projectPlaylistCloneRead,installPlaylistClonePreview} from './playlist-clone.js';
import {PatternChannelOps,SampleWaveformCache,patternChannelOpsSupported,channelColor,channelIcon,channelIconGlyph,CHANNEL_ICONS,randomChannelColor,freeCutGroup,sampleWaveformSvg} from './pattern-channel-ops.js';
import {formatTransportPosition} from './transport-position.js';
import {PlaylistLoopRegion} from './playlist-loop.js';
import {CloudExportDialog} from './cloud-export-dialog.js';
import {CloudRangeDialog} from './cloud-range-dialog.js';
import {CloudSampleEditorDialog} from './cloud-sample-editor-dialog.js';
import {CloudRegionEffectsDialog} from './cloud-region-effects-dialog.js';
import {CloudTimingMap} from './cloud-timing-map.js';
import {CloudTimingMapDialog} from './cloud-timing-map-dialog.js';
import {CloudRangeEditController} from './cloud-range-edits.js';
import {AudioSliceController,audioEditCheckpoint} from './audio-slice.js';
import {PlaylistClipboard} from './playlist-clipboard.js';
import {openSaveAsDialog} from './save-as-dialog.js';
import * as PianoTools from './piano-tools.js';
import {fitPianoZoomRectangle} from './piano-zoom.js';
import {PianoScrubGesture} from './piano-scrub.js';
import {PianoKeyAuditionGesture} from './piano-key-audition.js';
import {PIANO_SNAP_MODES,resolvePianoSnap,quantizePianoPosition} from './piano-snap.js';
import {PianoGesture,movePianoGesture,velocityPianoGesture} from './piano-gesture.js';
import {PianoStroke,visiblePianoPasteBeat} from './piano-stroke.js';
import {slicePianoLine} from './piano-slice.js';
import {pianoGhostMarkup,isPianoGhostToggle} from './piano-ghosts.js';
import {PIANO_DEFAULT_BAR_WIDTH,PIANO_ROW_HEIGHT,PIANO_KEY_WIDTH,PIANO_RULER_HEIGHT,PIANO_PITCH_COUNT,PIANO_VELOCITY_RANGE,pianoNoteTop,applyPianoGeometry,setPianoFold,pianoFold,pianoRowCount,pianoRowOfPitch,pianoPitchOfRow,pianoUnfoldedRow,pianoPitchShift} from './piano-geometry.js';
import {patternPreviewSvg,patternLengthBeats} from './pattern-preview.js';
import {setPatternLengthBars,growPatternForNotes} from './pattern-length.js';
import {computePlaylistGesture} from './playlist-edits.js';
import {trimPlaylistClipStart,playlistTrimEdge,playlistTrimMinimumBeats} from './playlist-trim.js';
import {slipPlaylistClipContents} from './playlist-slip.js';
import {planPatternClipMute} from './item-mute.js';
import {planAudioClipMute,AudioClipMuteHistory,audioClipMuteLabel,audioClipMuteTooltip,audioClipMuted,audioClipMuteReloadMessage,sendAudioClipMute,clipMuteRejected} from './audio-clip-mute.js';
import {PlaylistSelection,movePlaylistSelection,playlistClipIdsInRect} from './playlist-selection.js';
import {PlaylistKeyboardGesture} from './playlist-keyboard.js';
import {PlaylistNavigator} from './playlist-navigator.js';
import {attachPianoNavigator} from './piano-navigator.js';
import {PlaylistAutoScroll} from './playlist-autoscroll.js';
import {PlaylistStrokeGesture,paintedPatternPlacement} from './playlist-stroke.js';
import {createFLPatternSplitController} from './pattern-split.js';
import {ClipGesturePainter} from './clip-gesture-painter.js';
import {ClipWaveformController,clipWaveformSvg} from './clip-waveform.js';
import {AblWaveforms,canvasWaveformsSupported} from './abl-waveforms.js';
import {LiveRecordingClip} from './abl-record-clip.js';
import {linearTakePlacement} from './abl-clip-model.js';
import {LaunchQueue} from './abl-launch-queue.js';
import {sessionSlotId,normalizeLaunchQuantize,launchQuantizeLabel,DEFAULT_LAUNCH_QUANTIZE} from './abl-scene-launch.js';
import {freestyleHost as ablWaveformHost} from './freestyle-host-transport.js';
import {patternPlaybackAt} from './playback-view.js';
import {CloudLibraryBrowser} from './library-browser.js';
import {LibraryDragDiagnostics} from './library-drag-diagnostics.js';
import {inspectLibraryPreviewError} from './library-preview-error.js';
import {openMixerTools,openPasteChannelStripSheet,MixerToolsController,normalizeLoadedPlugins,expectedPluginFields,NATIVE_PLUGIN_CATALOG} from './mixer-tools.js';
import {fxSlotMenuItems,savedSlotPlugins} from './mixer-fx-slot-menu.js';
import {registerPluginWindow,refreshPluginWindows} from './plugin-window-registry.js';
import {WindowManager} from './window-manager.js';
import {TimelineViewport} from './timeline-viewport.js';
import {PLAYLIST_GUTTER,playlistLayout,playlistDropBeat,playlistDropRecord,installPlaylistDragHotspot,playlistGridOrigin,playlistGeometryProbe} from './playlist-geometry.js';
import {clientLog} from './client-diagnostics.js';
import {setLaneRowHint,laneRowHints,replaceLaneRowHints} from './playlist-row-hints.js';
import {playlistTrackMenuItems,laneContents,deleteBlockReason,moveRow,moveRowTo,savedRowOrder,duplicateBlockReason,PlaylistTrackActions} from './playlist-track-menu.js';
import {mountStudioIcons} from './studio-icons.js';
import {RemotePluginEditor} from './remote-plugin.js';
import {CloudPluginEditorLifecycle} from './cloud-plugin-editor.js';
import {PluginGuiView,pluginGuiSupported,createGuiParameterSync,BUS_PLUGIN_GUI_OPERATIONS} from './plugin-gui-view.js';
import {AblReadOnlyIndicator} from './abl-readonly.js';
import {EditorFrameStream} from './editor-frame-stream.js';
import {PluginGestureRecorder,cachedGestureSnapshot,readGestureSnapshot,applyGestureChanges,applyGestureChangesGuarded,fastGestureEligible,gestureStepLabel,formatPluginValueText} from './plugin-gesture-history.js';
import {mountPluginEqTab,eqEditsInFlight} from './eq-plugin-tab.js';
import {mountMixerEqSection,isTransientEqError} from './mixer-eq-section.js';
import {eqSupported} from './eq-editor.js';
import {STUDIO_API_OPERATIONS} from './studio-api-client.js';
import {resolvePluginEditorBinding,resolveRestPluginEditorBinding} from './plugin-editor-binding.js';
import {openCloudPanel,getCloudStatus} from './cloud-panel.js';
import {hostFetch,prepareFreestyleMedia,bridgeDiagnostics} from './freestyle-host-transport.js';
import {startEmbeddedStudio} from './freestyle-embed.js';
import {AutomationStore,paintAutomationTracks,createAutomationFromControl,automationHostClip,chooseAutomationHost,laneAutomationWindow,laneVolumeValue,lanePanValue} from './automation-ui.js';
import {automationHostClips,automationHostPlan} from './automation-host-clip.js';
import {PluginInventoryCache,prewarmLaneScopes} from './plugin-inventory-cache.js';
import {BACKING_NOT_EDITABLE} from './backing-lane.js';
import {rulerScale,rulerBarMarkup,rulerGridWidths} from './ruler-scale.js';
import {LiveMixSweep,liveMixSweepRequest,liveMixSweepKey} from './live-mix-sweep.js';
import {followTempoPlacements} from './abl-tempo-follow.js';
// Exact fast paths (ids are unique): "#id" is getElementById, and "#id X" with X
// one compound selector (no combinator, comma or space) is X queried under that
// element: the same nodes in document order, without walking the whole document
// on every render (happy-dom tests and large real projects alike).
const SCOPED_SELECTOR=/^#([A-Za-z][\w-]*)\s+([^\s,>+~]+)$/;
const $=s=>{if(/^#[A-Za-z][\w-]*$/.test(s))return document.getElementById(s.slice(1));const m=SCOPED_SELECTOR.exec(s);if(m){const root=document.getElementById(m[1]);return root?root.querySelector(m[2]):null;}return document.querySelector(s);};
/** Re-parse static markup (piano keys, ruler) only when it actually changed. */
const renderedMarkup=new WeakMap();
function setMarkupIfChanged(element,html){if(!element)return;if(renderedMarkup.get(element)===html&&element.childElementCount)return;element.innerHTML=html;renderedMarkup.set(element,html);}
const $$=s=>{const m=SCOPED_SELECTOR.exec(s);if(m){const root=document.getElementById(m[1]);return root?[...root.querySelectorAll(m[2])]:[];}return[...document.querySelectorAll(s)];};
const uid=()=>crypto.randomUUID().slice(0,8), clone=x=>JSON.parse(JSON.stringify(x)), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
document.documentElement.style.setProperty('--playlist-gutter',`${PLAYLIST_GUTTER}px`);
const colors=['#8fab99','#ae929b','#9aaac1','#b2a783','#98b2b1','#a798bc','#b39a85'];
const engine=new CloudEngine();
// Automation envelopes live inside clips ; the Playlist shows them as FL automation clips.
const automationStore=new AutomationStore({call:(name,args,options)=>engine.session.call(name,args,options),studio:{call:(...args)=>restMixer.client.call(...args)},getProjectId:()=>engine.ready?project?.cloud?.projectId||project?.id||null:null});
let selectedAutomationKey=null,automationLoadScope='',logicAutomation=null;const logicPluginParams=new Map();
// FL: plugin automation on a lane with no clip first places the lane's source pattern there (one Undo step with the envelope).
const automationHosts=automationHostClips({session:{action:(...args)=>engine.session.action(...args)},readRaw:async()=>{const data=await engine.session.call('get_project',{project_id:engine.projectId});return data?.response??data;},refresh:()=>engine.refresh(),store:automationStore,history:()=>engine.patternHistory});
const automationPlayheadBeat=()=>Number(engine.positionAt?.()?.beat??engine.beat)||0;
const pluginInventory=new PluginInventoryCache();let pluginInventoryScope='';
automationStore.addEventListener('change',()=>paintAutomationClips());
// A saved (or deleted) plug-in parameter envelope changes what that plug-in shows: an open GUI window redraws from a fresh frame.
automationStore.addEventListener('change',event=>{const detail=event.detail||{},target=detail.saved?.target??(detail.deleted?automationStore.confirmed?.get?.(detail.key)?.target:null);if((detail.saved||detail.deleted)&&target?.kind==='plugin_parameter'&&target.pluginInstanceId)refreshPluginWindows({projectId:engine.projectId,instanceId:target.pluginInstanceId});});
const libraryDragDiagnostics=new LibraryDragDiagnostics({document});
window.addEventListener('beforeunload',()=>libraryDragDiagnostics.destroy(),{once:true});
const monitorVolumeControl=mountMonitorVolumeControl($('#monitor-volume'),{monitor:engine.monitor,onStatus:message=>{$('#hint').textContent=message;}});
let sampleEditor=null,timingMap=null,timingDialog=null,regionEffects=null;
/* Disabelton: edits queued behind a running file import (see queueBehindImport) */const importEditQueue=[];let importDrainTimer=null,importWaitTimer=null,importDraining=false;
let fileDrop=null,laneCreate=null,laneCreateDialog=null,playlistClipboardBusy=false,audioImportBusy=false,audioImportFeedback=null,rackRegistrationBusy=false;
const playlistClipboard=new PlaylistClipboard(),playlistClipboardRecords=[],pendingPlacementIds=new Map();
let lastPlaylistClone=null,playlistClonePending=false;
let restMixer=null,mixerQueue=null,mixRevision=null,mixAdoptTimer=null,shownLiveMix=null,liveMixTimer=null;
// FL per-clip audio mute (setClipMuted). Overlay = optimistic/confirmed values until canonical reload.
const audioClipMutes=new AudioClipMuteHistory(),audioClipMuteOverlay=new Map();
const mixerHistoryPending=new Map();/* in-flight mixer Undo/Redo values (optimistic) */
let mixerLastOperation='bus',mixerState=null,mixerPan=null,mixerPanRawState=null,mixerPanReadSequence=0,mixerPanReadRequest=null,mixerMaster=null,mixerMasterRawState=null,mixerMasterReadSequence=0,mixerMasterReadRequest=null,mixerLive=null,mixerRouting=null,mixerRoutingDialog=null,mixerLiveRawState=null,mixerLiveReadSequence=0,mixerLiveReadRequest=null,mixerModelCache=null,mixerModelEpoch=0,mixerView=null,selectedMixerKey=mixerRowKey('bus','master');
let stepPage=0,pianoTarget='',pianoNeedsFocus=true,pianoCursor=0,pianoClipboard=null,pianoGhostsEnabled=true,activePianoCancel=null,noteProperties=null,notePropertiesFrame=null,notePropertiesPreview=null;const selectedNotes=new Set();
const notePropertiesStyles=new Map();
let project, selectedChannel='kick', mixerChannel='master', mode='song', tool='select', pianoTool='select', pianoCommandTool='draw', barWidth=30,playlistLaneHeight=24,playlistZoomPrevious=null,pianoBarWidth=PIANO_DEFAULT_BAR_WIDTH,pianoRowHeight=PIANO_ROW_HEIGHT,pianoZoomPrevious=null,pianoScrubCancel=null,pianoSnapMode='main',pianoSnapMenuCancel=null, selectedClip=null, selectedNote=null, importedTarget=null, recording=false, dirty=false;
document.documentElement.style.setProperty('--piano-bar',`${PIANO_DEFAULT_BAR_WIDTH}px`);
let playlistLoop,playlistNavigator=null,pianoNavigator=null,activePlaylistCancel=null,lastOperationError=null,metronomeRenderKey='',playlistStrokeElement=null,playlistStrokePointer=null;
const playlistStrokeMarkers=new Map(),playlistStrokeVisibility=new Map();
const rackControlWidgets=[];let activeRackKnob=null,rackControlSyncTimer=null;
let activeRackCancel=null,rackStepElement=null,rackStepPointer=null,useBothStepButtons=false;
// FL default: left-click toggles a step (drag paints from the first step's state), right-click clears.
try{useBothStepButtons=localStorage.getItem('disabelton:step-mouse-mode')==='both';}catch{}
const rackStepStyles=new Map(),rackMembershipAttempts=new Map();
let rackMembershipBusy=false,rackMembershipLocalCommit=false;
const mixerFxStates=new Map(),mixerFxReadRequests=new Set();
let rackGraph=null,rackGraphLocalCommit=false,rackSelector=null,rackClipboard=null,rackClipboardBusy=false,rackClipboardWriter=null,selectedRackRow=null,rackViewCache=null,rackViewError=null;
const patternSlices=new Map();
const audioSlices=[];
const audioSliceEntry=()=>[...audioSlices].reverse().find(entry=>entry.projectId===engine.projectId);
const audioSliceBusy=()=>audioSlices.some(entry=>entry.controller.busy);
// Round 15: a press only routes to the slice that can take it (Redo after a
// slice that is still applied falls through to the other owners).
const audioSliceHistoryEntry=direction=>[...audioSlices].reverse().find(entry=>{if(entry.projectId!==engine.projectId||entry.revision!==audioRangeRevision)return false;const state=entry.controller.snapshot();if(state.uncertain||state.needsInspection)return true;return direction==='undo'?!!state.applied:direction==='redo'?!state.applied&&state.status==='undone':!!state.applied||state.status==='undone';});
const sliceRecords=()=>patternSlices.get(engine.projectId)||[];
let sliceReloading=false,rangeEdits=null,audioRangeRevision=0;
function rangeBusy(){return !!rangeEdits?.busy;}
function mixerBusy({ignoreRestMixer=false}={}){return !ignoreRestMixer&&!!restMixer?.busy||[mixerState,mixerPan,mixerMaster,mixerLive].some(controller=>controller?.busy&&!['read','inspect'].includes(controller.operation?.kind))||!!(mixerRouting?.busy&&mixerRouting.operation?.phase!=='inspecting');}
function mixerRequestBusy(){return !!(restMixer?.busy||mixerState?.busy||mixerPan?.busy||mixerMaster?.busy||mixerLive?.busy||mixerRouting?.busy);}
function workspaceBusy({ignoreAudioImport=false,ignoreRegionEffects=false,ignoreRestMixer=false,ignorePatternHistory=false,ignoreRackMembership=false,ignoreFileImport=false}={}){if(ignoreFileImport){ignoreAudioImport=true;}return laneMoveBusy||!ignoreRackMembership&&rackMembershipBusy&&!rackMembershipLocalCommit||!!sampleEditor?.busy||!ignoreRegionEffects&&!!regionEffects?.busy||timingMap?.operation?.kind==='write'||rackRegistrationBusy||!ignorePatternHistory&&!!engine.historyPending||!ignorePatternHistory&&!!engine.patternHistory?.busy||!ignoreAudioImport&&audioImportBusy||mixerBusy({ignoreRestMixer})||audioSliceBusy()||playlistClipboardBusy||playlistClonePending||!ignoreFileImport&&!!fileDrop?.busy||!!laneCreate?.busy||!!laneCreateDialog?.busy||audioClipMutes.busy;}
/** Named reasons a core cloud write (Playlist sample drop, file import) cannot
 * start yet. Mirrors workspaceBusy()+coreFileEditable(); each reason's first-seen
 * time is retained so a stuck flag is visible in vegetableStudio.cloudBlockers(). */
const cloudBlockerSince=new Map();
function cloudBlockerReasons({ignoreAudioImport=false}={}){
 const reasons=[],mixer=[['rest',restMixer],['bus',mixerState],['pan',mixerPan],['master',mixerMaster],['live',mixerLive],['routing',mixerRouting]].filter(([,controller])=>controller?.busy).map(([name,controller])=>`mixer-${name}:${controller.operation?.kind||'busy'}/${controller.operation?.phase||''}`);
 const add=(flag,name)=>{if(flag)reasons.push(name);};
 add(rackMembershipBusy&&!rackMembershipLocalCommit,'rack-membership');add(rackRegistrationBusy,'rack-registration');add(samplePlacementBusy,'sample-placement');add(!!sampleEditor?.busy,'sample-editor');add(!!regionEffects?.busy,'region-effect');add(timingMap?.operation?.kind==='write','timing-map');
 add(!!engine.historyPending,'history');add(!!engine.patternHistory?.busy,'pattern-history');add(!ignoreAudioImport&&audioImportBusy,'audio-import');add(playlistClipboardBusy,'playlist-clipboard');add(playlistClonePending,'playlist-clone');add(!!fileDrop?.busy,'file-drop');
 add(!!laneCreate?.busy||!!laneCreateDialog?.busy,'lane-create');add(audioClipMutes.busy,'clip-mute');add(audioSliceBusy(),'audio-slice');add(rangeBusy(),'audio-range');add(sliceBusy(),'pattern-slice');add(rackClipboardBusy,'rack-clipboard');add(!!rackGraph?.busy,'rack-graph');add(!!cloudLibrary?.writeBusy,'library-write');
 add(!!engine.loading,'project-load');add(!!engine.applying,'edit-save');add(!!engine.interacting,'pointer-gesture');
 if(mixerBusy())reasons.push(...(mixer.length?mixer:['mixer']));
 const now=performance.now();for(const key of [...cloudBlockerSince.keys()])if(!reasons.includes(key))cloudBlockerSince.delete(key);for(const key of reasons)if(!cloudBlockerSince.has(key))cloudBlockerSince.set(key,now);
 return reasons;
}
let cloudQueueTimeoutMs=20000,cloudQueueWaits=[];
/** FL never refuses a drop: wait (bounded) for the blocking write to finish
 * instead of refusing. Rejects at once without a project; never retries. */
function waitForCloudIdle(label,{timeoutMs=cloudQueueTimeoutMs,ignoreAudioImport=false,onQueued=()=>{}}={}){
 const started=performance.now(),scope=JSON.stringify(fileImportScope());let first=null;
 return new Promise((resolve,reject)=>{const poll=()=>{
  if(!engine.ready)return reject(new Error('Select or create a Freestyle project first.'));
  if(scope!==JSON.stringify(fileImportScope()))return reject(new Error(`The project changed while the ${label} was waiting; it was not sent.`));
  const reasons=cloudBlockerReasons({ignoreAudioImport}),waited=performance.now()-started;
  if(!reasons.length){if(first){cloudQueueWaits.push({label,reasons:first,waitedMs:Math.round(waited)});cloudQueueWaits=cloudQueueWaits.slice(-20);}return resolve(waited);}
  if(!first){first=reasons;clientLog('cloud-action-queued',{label,blockers:reasons.map(reason=>({reason,forMs:Math.round(performance.now()-(cloudBlockerSince.get(reason)??performance.now()))}))});try{onQueued(reasons);}catch{}}
  if(waited>=timeoutMs){clientLog('cloud-action-refused',{label,reasons,waitedMs:Math.round(waited)});cloudQueueWaits.push({label,reasons,waitedMs:Math.round(waited),timedOut:true});return reject(Object.assign(new Error(`The ${label} was not sent: Freestyle is still busy (${reasons.join(', ')}) after ${timeoutMs<1000?(timeoutMs/1000).toFixed(1):Math.round(timeoutMs/1000)} s. Try again.`),{code:'cloud_queue_timeout',reasons}));}
  setTimeout(poll,40);
 };poll();});
}
engine.canInteractiveRefresh=()=>!workspaceBusy()&&!rangeBusy()&&!sliceBusy()&&!rackClipboardBusy&&!rackGraph?.busy&&!cloudLibrary?.writeBusy;
function assertRangeIdle({ignorePatternHistory=false}={}){if(workspaceBusy({ignorePatternHistory}))throw new Error('Wait for the current cloud operation to finish.');if(rangeBusy())throw new Error('Wait for the current audio range request to finish.');}
function sliceBusy(){if(sliceReloading)return true;for(const records of patternSlices.values())for(const controller of records)if(controller.inFlight)return true;return false;}
const sliceUncertain=()=>sliceRecords().some(controller=>controller.state.status==='uncertain');
const sliceRecoveryController=()=>sliceUncertain()?null:[...sliceRecords()].reverse().find(controller=>controller.state.applied);
let toastTimer, front=16,queuedProject=null,lastTickKey='',lastTickStep=-1,lastLoopKey='',editCursorBeat=0,cursorProjectId=null;
function freshProject(){return {version:2,title:'Connect a Freestyle project',bpm:120,master:1,metronome:false,loop:true,selectedPattern:'empty',channels:[{id:'empty',name:'No cloud project',type:'cloud',volume:1,pan:0,mute:false,solo:false,effects:{}}],patterns:[{id:'empty',name:'No pattern selected',bars:1,steps:{},notes:{}}],clips:[]};}
project=freshProject();
const allClips=()=>[...project.clips,...(project.audioClips||[])];
const playlistSelection=new PlaylistSelection(project);
let waveformQueued=false,waveformTimer=null,waveformPaintPending=false;
const clipWaveforms=new ClipWaveformController({call:(name,args,options)=>engine.session.call(name,args,options),getContext:()=>({projectId:engine.projectId,trackId:engine.session.trackId,version:engine.loadVersion||0}),onChange:()=>queueCloudWaveforms()});
/* Owner bug 1: canvas waveforms from a per-source peak pyramid (waveform-pyramid.js). Once seen, a waveform is never replaced by a
   placeholder: scroll / zoom / drag / trim repaint synchronously from cached peaks. The SVG reader above stays as the fallback where
   no 2D canvas exists. */
const ablWaveforms=canvasWaveformsSupported(document)?new AblWaveforms({host:()=>{const host=ablWaveformHost();if(!host?.apiFetch)throw new Error('Freestyle is not connected.');return host;},getProjectId:()=>engine.projectId,getTrackId:()=>engine.session.trackId||null,getClip:id=>findClip(id),getBpm:()=>project.bpm,getPxPerBeat:()=>barWidth/4,root:document.querySelector('#track-lanes'),viewport:document.querySelector('#arrangement-scroll')}):null;
if(ablWaveforms){const invalidate=clipWaveforms.invalidate.bind(clipWaveforms);clipWaveforms.invalidate=clipId=>{try{ablWaveforms.invalidate(clipId);}catch{}return invalidate(clipId);};window.ablWaveforms=ablWaveforms;}
function paintPlaylistSelection(){$$('#playlist .clip[data-clip]').forEach(el=>el.classList.toggle('selected',playlistSelection.has(el.dataset.clip)));playlistNavigator?.refresh();logicShellHooks.selection?.();}
const findClip=id=>allClips().find(c=>c.id===id);
const pattern=()=>project.patterns.find(p=>p.id===project.selectedPattern)||project.patterns[0];
const channel=()=>project.channels.find(c=>c.id===selectedChannel)||project.channels[0];
// Hardware MIDI input (assigned after the typing audition below) and FL's
// Piano roll "preview notes" helper, which is on by default.
let midiInput=null,pianoPreviewNotes=true;
function queueRackControlSync(){if(rackControlSyncTimer!==null)return;rackControlSyncTimer=setTimeout(()=>{rackControlSyncTimer=null;for(const widget of rackControlWidgets)widget.sync();try{syncRackSwing();}catch{}},0);}
function toast(message,{transient=false}={}){queueRackControlSync();/* Disabelton: Logic wording (region, Tracks area, Step Sequencer) on every toast */$('#toast').textContent=logicCopy(message);$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3500);const status=$('#status-message'),text=filePickerFeedbackMessage(playClockReadFeedback(message));status.textContent=text;/* QA r13: a transient notice (e.g. a patch switch refusal) leaves the status bar with the toast */if(transient)setTimeout(()=>{if(status.textContent===text)status.textContent='';},3500);}
function fail(e){if(e?.name==='AbortError'||e?.rollbackShown)return;/* a refused save is shown once, by engine.onEditRejected */if(isMixRevisionConflict(e)){e.message=MIX_CONFLICT_NOTICE;noteMixConflict(e);}lastOperationError={message:e.message||String(e),code:e.code||'',status:e.status||'',at:Date.now()};try{clientLog('operation-error',{message:String(lastOperationError.message).slice(0,200),code:lastOperationError.code||null,stack:String(e?.stack||'').split('\n').slice(1,4).join(' | ').slice(0,300)});}catch{}if(historyUiOperation)historyUiOperation.error=lastOperationError.message;if(audioImportFeedback?.active&&audioImportFeedback.scope===JSON.stringify(fileImportScope()))audioImportFeedback.error=lastOperationError.message;const reading=currentPlayClockRead();if(reading)reading.error=lastOperationError.message;console.error(e);toast(lastOperationError.message,{transient:e?.transient===true});}
function checkpoint(){}
function changed(render=true){syncProjectStepPiano(project);audioRangeRevision++;dirty=true;engine.update(project);if(render)renderAll();else renderSummary();}
function edit(fn,render=true){if(importEditQueue.length&&!importDraining&&!fileImportInFlight())drainImportQueue();if(workspaceBusy()&&importEditGate()||importEditQueue.length&&!importDraining){/* Logic/FL: an edit made during a file import queues behind it (never refused) */return queueBehindImport('Edit',()=>edit(fn,render));}if(workspaceBusy()){clientLog('edit-refused',{blockers:cloudBlockerReasons().map(reason=>({reason,forMs:Math.round(performance.now()-(cloudBlockerSince.get(reason)??performance.now()))}))});toast('Wait for the cloud operation to finish.');return false;}if(rackClipboardBusy){toast('Wait for the Channel Rack clipboard operation to finish.');return false;}if(rackGraph?.writing&&!rackGraphLocalCommit){toast('Wait for the step velocity edit to finish.');return false;}if(rangeBusy()){toast('Wait for the current audio range request to finish.');return false;}if(sliceBusy()){toast('Wait for the cloud pattern slice to finish.');return false;}if(cloudLibrary?.writeBusy){toast('Wait for the cloud library operation to finish.');return false;}if(engine.editBlocked){toast('Waiting for Freestyle to finish the previous edit…');return false;}if(!engine.ready){toast('Select or create a Freestyle project first.');openCloudPanel().catch(fail);return false;}activePlaylistCancel?.();activePianoCancel?.();if(!rackEditKeepsGesture)activeRackCancel?.();checkpoint();const lengthsBefore=patternLengthsNow();fn();rackViewCache=null;/* edits mutate `project` in place: the identity-keyed rack view must be rebuilt */changed(render);followPatternLengths(lengthsBefore);return true;}
// Round 12: the rack's own step saves (source registration, queued-click
// replay) must not cancel the click the user is holding; it commits per cell
// against the rows it started on and queues behind them.
let rackEditKeepsGesture=false;
function rackEdit(fn){rackEditKeepsGesture=true;try{return edit(fn);}finally{rackEditKeepsGesture=false;}}
function clipboardUncertain(){return playlistClipboardRecords.some(record=>record.projectId===engine.projectId&&record.controller.uncertain&&!record.inspected);}
function clipboardHistoryEntry(redo=false){return [...playlistClipboardRecords].reverse().find(record=>!record.abandoned&&record.projectId===engine.projectId&&record.applied===!redo&&record.revision===audioRangeRevision);}
// Edit-relevant audio state at storage precision (round 15): volatile row
// metadata or a receipt-painted vs read row is not a clipboard-history change.
function clipboardAudioState(clips){return audioEditCheckpoint({audioClips:clips||[]});}
function clipboardCheckpoint(audio,placements){return Array.isArray(audio)&&clipboardAudioState(audio)===clipboardAudioState(project.audioClips)&&JSON.stringify(placements)===JSON.stringify(project.clips);}
function abandonClipboardRedo(record){historyNewStep('audio');for(const previous of playlistClipboardRecords){if(previous===record)break;if(!previous.applied&&previous.controller.snapshot().status==='undone')previous.abandoned=true;}}
function bridgeClipboardHistory(record,redo){
 if(record.controller.uncertain||record.controller.snapshot().refreshError||!record.controller.isCurrent())return;
 const index=playlistClipboardRecords.indexOf(record),candidates=redo?playlistClipboardRecords.slice(index+1):playlistClipboardRecords.slice(0,index).reverse();
 for(const candidate of candidates){if(candidate.projectId!==engine.projectId||candidate.abandoned)continue;const state=candidate.controller.snapshot();if(candidate.controller.uncertain||state.refreshError)return;if(!candidate.applied&&state.status!=='undone'){if(candidate.afterPattern)return;continue;}if(candidate.applied===redo)continue;
  if(!candidate.controller.isCurrent())return;const matches=redo?clipboardCheckpoint(candidate.beforeAudio,candidate.beforePattern):clipboardCheckpoint(candidate.afterAudio,candidate.afterPattern||candidate.beforePattern);if(matches)candidate.revision=audioRangeRevision;return;
 }
}
async function inspectPlaylistClipboard(){assertRangeIdle();await engine.refresh();for(const record of playlistClipboardRecords)if(record.projectId===engine.projectId)record.inspected=true;toast('Playlist clipboard state reloaded. No edit was repeated.');}
async function playlistCloneAction(options){
 if(!engine.ready||workspaceBusy()||engine.interacting||engine.editBlocked||rangeBusy()||sliceBusy())throw new Error('Finish the current cloud operation before cloning Playlist clips.');
 if(clipboardUncertain())throw new Error('Inspect the previous Playlist clipboard operation before cloning.');
 playlistClonePending=true;try{await engine.flush();if(JSON.stringify(options.sourceScope)!==JSON.stringify(fileImportScope()))throw new Error('The captured Playlist clone context changed before release.');
 const select=state=>{if(!['committed','undone'].includes(state.status))return;const ids=state.status==='committed'?state.plan.sourceIds.map(id=>[...state.ownedPatterns,...state.ownedAudio].find(item=>item.sourceId===id)?.id).filter(Boolean):[];playlistSelection.sync(project);if(options.selectCreated&&ids.length)playlistSelection.select(ids);else playlistSelection.clear();selectedClip=options.selectCreated?ids[0]||null:null;paintPlaylistSelection();};
 const controller=new PlaylistCloneController({phaseWritable:engine.session.supportsPlacementPhase?.('create')===true,getProject:()=>project,getScope:fileImportScope,flush:()=>engine.flush(),call:(...args)=>engine.session.call(...args),action:(...args)=>engine.session.action(...args),read:async()=>{const scope=fileImportScope(),result=await engine.session.call('get_project',{project_id:scope.projectId});if(JSON.stringify(scope)!==JSON.stringify(fileImportScope()))throw new Error('The project changed while reading Playlist clones.');const saved=projectPlaylistCloneRead(engine,result,scope);engine.session.rawProject=saved.rawProject;engine.session.rawState=saved.rawState;engine.session.project=saved.project;engine.accept(saved.project);return saved.project;},onChange:state=>{lastPlaylistClone=controller;select(state);mixerView?.render();}});
 const history=installPlaylistClonePreview(engine.patternHistory),token=history.beginPlaylistClone(controller);lastPlaylistClone=controller;
 try{const state=await controller.create(options);history.finishPlaylistClone(token);audioRangeRevision++;select(state);renderAll();toast(playlistCopiesSavedMessage(state.ownedPatterns.length+state.ownedAudio.length)+(state.reconciled?' Freestyle stored a slightly different position; the copy is shown where it was saved.':''));if(state.reconciled)clientLog('playlist-clone-reconciled',{copies:state.ownedAudio.length});if(state.rebased)clientLog('playlist-clone-rebased',{keys:state.rebased.keys,copies:state.ownedPatterns.length+state.ownedAudio.length});return state;}
 catch(error){history.failPlaylistClone(token,error);/* QA r4: a refused copy says so — nothing was saved, so ⌘Z will undo the previous step */if(!controller.snapshot().attempted&&error?.name!=='AbortError'&&!/^Not copied/.test(error.message||''))error.message=`Not copied — nothing was saved. ${error.message||''}`.trim();throw error;}
 }finally{playlistClonePending=false;renderAll();}
}
async function playlistClipboardAction(action){
 if(!engine.ready||workspaceBusy()||engine.interacting||engine.applying||rangeBusy()||sliceBusy())return toast('Finish the current cloud operation before using the Playlist clipboard.');
 if(clipboardUncertain())return toast('Reload Playlist clipboard state from Edit before another clipboard edit.');
 try{if(action==='copy'){
   // QA round 19: ⌘C never silently copies nothing. FL copies the focused clip when no box selection exists.
   const ids=playlistSelection.ids.size?playlistSelection.ids:selectedClip&&allClips().some(clip=>clip.id===selectedClip)?new Set([selectedClip]):new Set();
   const copied=playlistClipboard.copy({project,selectedIds:ids});clientLog('playlist-clipboard',{action:'copy',selected:playlistSelection.ids.size,fallbackClip:!playlistSelection.ids.size&&ids.size>0,copied:copied?.entries?.length??0});
   if(copied)toast(`Copied ${copied.entries.length} Playlist clip${copied.entries.length===1?'':'s'}.`);else toast('Select Playlist clips to copy (click a clip, or drag a box).');return copied;}
  const plan=action==='cut'?playlistClipboard.cut({project,selectedIds:playlistSelection.ids}):action==='duplicate'?playlistClipboard.duplicate({project,selectedIds:playlistSelection.ids}):playlistClipboard.paste({project,at:editCursorBeat});clientLog('playlist-clipboard',{action,changed:!!plan.changed,clipboard:!!playlistClipboard.snapshot(),selected:playlistSelection.ids.size,created:plan.createdIds?.length??0});if(!plan.changed){toast(action==='paste'?(playlistClipboard.snapshot()?'Nothing to paste here.':'Copy Playlist clips first (⌘C), then paste (⌘V).'):'Select Playlist clips first.');return;}playlistClipboard.assertCurrent(plan,project);
  if(!plan.audioOps.length){const count=Math.max(1,plan.createdIds.length);engine.patternHistory.hintLabel?.(`${action==='duplicate'?'Duplicate':action==='cut'?'Cut':'Paste'} pattern ${count===1?'clip':'clips'}`);if(edit(()=>{project.clips=clone(plan.clips);selectedClip=plan.createdIds[0]||null;})){playlistSelection.sync(project);playlistSelection.select(plan.createdIds);paintPlaylistSelection();toast(clipClipboardMessage(action,action==='cut'?plan.removedIds?.length:plan.createdIds.length));}else engine.patternHistory.hintLabel?.(null);return plan;}
  const scope=JSON.stringify(fileImportScope()),beforePattern=clone(project.clips),hasPatterns=JSON.stringify(plan.clips)!==JSON.stringify(project.clips),timing=audioClipboardTiming(action,plan),ghosts=showPendingAudioOps(plan.audioOps),audioOwner=engine.patternHistory?.beginOwnedAudioChange?.();timing.mark('ghost');
  const controller=new CloudRangeEditController({getProject:()=>project,getScope:fileImportScope,cloudCall:(name,args,options)=>engine.session.call(name,args,options),flush:()=>engine.flush(),onChange:()=>mixerView?.render(),onCommitted:adoptClipBatchReceipt}),record={projectId:engine.projectId,controller,plan,beforePattern,beforeAudio:clone(plan.expected.audioClips),afterPattern:null,afterAudio:null,revision:null,applied:false,inspected:false};playlistClipboardRecords.push(record);playlistClipboardBusy=true;
  try{await engine.flush();if(JSON.stringify(fileImportScope())!==scope)throw new Error('The project changed before pasting.');
   if(plan.requiresNativeCut||plan.consumesCut){
    playlistClipboard.assertCurrent(plan,project);let prepared;
    if(plan.requiresNativeCut){const results=[];toast('Preparing audio Cut…');for(const request of playlistClipboard.cutReadRequests(plan)){results.push(await engine.session.call('edit_time_range',request));if(JSON.stringify(fileImportScope())!==scope)throw new Error('The project changed while preparing audio Cut.');}playlistClipboard.assertCurrent(plan,project);prepared=playlistClipboard.prepareCut(plan,results);}
    else prepared={audioOps:plan.audioOps,inverseAudioOps:plan.inverseAudioOps,serverAuthoredOps:true};
    record.batch=prepared;timing.mark('prepared');await controller.applyBatch(prepared.audioOps,{inverseOps:prepared.inverseAudioOps,serverAuthoredOps:!!prepared.serverAuthoredOps,serverAuthoredInverse:!!prepared.serverAuthoredInverse});timing.mark('acknowledged');settlePendingAudioOps(ghosts,controller);record.applied=true;record.afterAudio=clone(project.audioClips||[]);abandonClipboardRedo(record);record.revision=++audioRangeRevision;
    if(JSON.stringify(fileImportScope())!==scope)throw new Error('The project changed after the audio edit. Its Undo receipt was retained.');
    if(hasPatterns){if(JSON.stringify(project.clips)!==JSON.stringify(beforePattern))throw new Error('The pattern placements changed while editing audio. Undo the retained audio edit before trying again.');project.clips=clone(plan.clips);changed();record.revision=audioRangeRevision;await engine.flush();record.afterPattern=clone(project.clips);}
    if(plan.requiresNativeCut)playlistClipboard.confirmCut(plan,{project,receipt:controller.snapshot().receipt});
    else{playlistClipboard.confirmPaste(plan,{project,receipt:controller.snapshot().receipt});if(!plan.created.length)playlistClipboard.copy({project,selectedIds:plan.createdIds});}
    playlistSelection.sync(project);playlistSelection.select(plan.createdIds);selectedClip=plan.createdIds[0]||null;renderAll();timing.done(controller);toast(plan.requiresNativeCut?'Playlist clips cut.':'Cut clips moved.');return controller.snapshot();
   }
   const journal=engine.patternHistory,journalTop=journal?.entries?.[journal.index-1]||null;let patternEntry=null;
   let ownPlacementIds=[];
   if(hasPatterns){project.clips=clone(plan.clips);changed();await engine.flush();record.afterPattern=clone(project.clips);const top=journal?.entries?.[journal.index-1]||null;if(top&&top!==journalTop)patternEntry=top;
    // QA r14: the audio batch's fresh read re-canonicalises these new placement rows; that echo is this paste's, not an outside edit.
    const savedIds=new Set(beforePattern.map(clip=>clip.cloudId).filter(Boolean));ownPlacementIds=project.clips.map(clip=>clip.cloudId).filter(id=>id&&!savedIds.has(id));journal?.declareOwnedPlacements?.(audioOwner,ownPlacementIds);}
   if(JSON.stringify(fileImportScope())!==scope)throw new Error('The project changed before the audio paste.');for(const op of plan.audioOps){const before=plan.expected.audioClips.find(clip=>clip.cloudId===op.source_id),actual=project.audioClips?.find(clip=>clip.cloudId===op.source_id);if(!before||!actual||['start','length','offset','laneId'].some(key=>before[key]!==actual[key]))throw new Error('The copied audio window changed. Inspect the Playlist before another paste.');}
   timing.mark('sending');await controller.applyBatch(plan.audioOps,{inverseOps:plan.inverseAudioOps});timing.mark('acknowledged');settlePendingAudioOps(ghosts,controller);record.applied=true;record.afterAudio=clone(project.audioClips||[]);
   // QA r14: the batch's read may re-canonicalise this paste's own new placement rows; the clipboard Undo guard then
   // compares against that post-paste state. Any change to another placement keeps the old guard (Undo refuses).
   if(record.afterPattern&&ownPlacementIds.length){const own=new Set(ownPlacementIds),others=rows=>JSON.stringify(rows.filter(clip=>!own.has(clip.cloudId))),ids=rows=>JSON.stringify(rows.map(clip=>clip.cloudId).sort());if(others(record.afterPattern)===others(project.clips)&&ids(record.afterPattern)===ids(project.clips))record.afterPattern=clone(project.clips);}
   // QA round 20: a mixed pattern+audio paste is ONE journal step (like a mixed erase).
   const savedBefore=new Set(beforePattern.map(clip=>clip.cloudId).filter(Boolean)),composed=!!patternEntry&&journal?.composeMixedPaste?.({entry:patternEntry,placementIds:project.clips.filter(clip=>clip.cloudId&&!savedBefore.has(clip.cloudId)).map(clip=>clip.cloudId),audioIds:plan.audioOps.filter(op=>op.op==='insert').map(op=>op.id),audioUndo:controller.snapshot().inverseOps,project,label:action==='duplicate'?'Duplicate clips':'Paste clips'})===true;
   // QA round 21: an audio-only paste / ⌘B is one journal step too (same ids on Redo).
   const audioPasteIds=plan.audioOps.filter(op=>op.op==='insert').map(op=>op.id),audioOnlyStep=!hasPatterns&&!composed&&journal?.recordAudioPaste?.({audioIds:audioPasteIds,audioUndo:controller.snapshot().inverseOps,project,label:(action==='duplicate'?'Duplicate ':'Paste ')+(audioPasteIds.length===1?'audio clip':'clips')})===true;
   if(audioOnlyStep)historyJournalObserved();
   clientLog('playlist-clipboard',{action,mixed:hasPatterns,composed,audioOnlyStep});
   if(composed||audioOnlyStep){record.abandoned=true;record.revision=null;++audioRangeRevision;}else{abandonClipboardRedo(record);record.revision=++audioRangeRevision;}playlistSelection.select(plan.createdIds);selectedClip=plan.createdIds[0]||null;renderAll();timing.done(controller);toast(clipClipboardMessage(action,action==='cut'?plan.removedIds?.length:plan.createdIds.length));return controller.snapshot();
  }finally{clearPendingAudioOps(ghosts);engine.patternHistory?.endOwnedAudioChange?.(audioOwner);playlistClipboardBusy=false;mixerView?.render();historyEditSettled();}
 }catch(error){fail(error);}
}
// FL: every Ctrl/Cmd+B press duplicates once. A press that arrives while the
// previous duplicate is still saving (or history is applying) waits its turn,
// in order, instead of being refused; each press saves as its own Undo step and
// keeps the new copy selected so the next press duplicates it again.
const DUPLICATE_QUEUE_LIMIT=32;let duplicateQueue=Promise.resolve(),duplicateQueueDepth=0;
function playlistDuplicateReady(){return engine.ready&&!engine.loading&&!engine.applying&&!engine.pending&&!engine.inFlight&&!engine.interacting&&!engine.historyPending&&!engine.patternHistory?.busy&&!engine.patternHistory?.optimisticPending&&!engine.patternHistory?.externalPending&&!playlistClipboardBusy&&!workspaceBusy()&&!rangeBusy()&&!sliceBusy();}
async function waitForPlaylistDuplicate(limitMs=20000){const started=Date.now();while(!playlistDuplicateReady()&&Date.now()-started<limitMs){if(engine.pending&&!engine.inFlight&&!engine.interacting)await engine.flush().catch(()=>{});else await new Promise(resolve=>setTimeout(resolve,25));}}
function queuePlaylistDuplicate(){
 if(duplicateQueueDepth>=DUPLICATE_QUEUE_LIMIT){clientLog('playlist-duplicate-queue',{event:'dropped_limit',depth:duplicateQueueDepth});return Promise.resolve();}
 const scope=JSON.stringify(fileImportScope()),queuedAt=Date.now();duplicateQueueDepth++;clientLog('playlist-duplicate-queue',{event:'queued',depth:duplicateQueueDepth});
 const step=async()=>{
  await waitForPlaylistDuplicate();if(scope!==JSON.stringify(fileImportScope()))return clientLog('playlist-duplicate-queue',{event:'cancelled',reason:'project_changed'});
  const plan=await playlistClipboardAction('duplicate');let copies=plan?.createdIds?.length||0;
  // Pattern copies are a local edit: save it now so it is one journal step and
  // the next press starts from the saved copy (its server ID stays selected).
  if(plan?.changed&&!plan.audioOps?.length){await engine.flush();const ids=engine.session.lastApplyIdMap?.placements||{},saved=plan.createdIds.map(id=>ids[id]||id).filter(id=>(project.clips||[]).some(clip=>clip.id===id));copies=saved.length;if(saved.length){playlistSelection.sync(project);playlistSelection.select(saved);selectedClip=saved[0];paintPlaylistSelection();}}
  clientLog('playlist-duplicate-queue',{event:'done',waitedMs:Date.now()-queuedAt,copies,depth:duplicateQueueDepth});
 };
 // Ordered with Undo/Redo presses: it runs after every press made before it.
 const run=Promise.all([duplicateQueue,historyQueue]).then(step).catch(error=>{clientLog('playlist-duplicate-queue',{event:'failed',error:String(error?.message||error).slice(0,200)});fail(error);}).finally(()=>{duplicateQueueDepth--;});
 duplicateQueue=run;return run;
}
/** FL: a Playlist pattern clip placed at the pattern's full length follows
 * that length (auto-extend from a late note, Patterns > Length); a clip that
 * was resized, repeated, trimmed, offset or re-phased keeps its own extent.
 * Freestyle stores placement durations explicitly and does not update them
 * when `bars` changes (live 2026-11-10T23:26Z), so the follow is saved right
 * after the pattern step and joins it: one Undo/Redo step, as in FL. */
function patternLengthsNow(){return new Map((project?.patterns||[]).map(pattern=>[pattern.id,patternLengthBeats(pattern)]));}
function followsPatternLength(clip,beats){const raw=clip?.cloudRaw||{},ms=beats*60000/project.bpm;return !!clip?.cloudId&&Math.round(Number(raw.repeatCount??1))===1&&raw.windowMs==null&&!Number(raw.offsetMs)&&!Number(raw.loopPhaseMs)&&Math.abs(Number(raw.durationMs)-ms)<1&&(raw.loopDurationMs==null||Math.abs(Number(raw.loopDurationMs)-Number(raw.durationMs))<1)&&Math.abs(clip.length-beats)<1e-6;}
function followPatternLengths(before){
 const grown=[...before].map(([id,beats])=>{const pattern=project.patterns.find(row=>row.id===id);return pattern&&{id,before:beats,after:patternLengthBeats(pattern)};}).filter(change=>change&&Math.abs(change.after-change.before)>1e-9);
 const followers=grown.flatMap(change=>(project.clips||[]).filter(clip=>clip.patternId===change.id&&followsPatternLength(clip,change.before)).map(clip=>({placementId:clip.cloudId,patternCloudId:project.patterns.find(row=>row.id===change.id)?.cloudId??change.id,from:Math.round(Number(clip.cloudRaw.durationMs)),to:Math.round(change.after*60000/project.bpm)})));
 if(!followers.length)return;const scope=JSON.stringify(fileImportScope());
 engine.flush().then(async()=>{
  if(JSON.stringify(fileImportScope())!==scope||!engine.ready)return;
  const history=engine.patternHistory,label=followers.length===1?'Fit pattern clip':'Fit pattern clips';let pending=null;
  // FL: one step. The fit joins the pattern step it follows; only when that
  // step is not the journal's newest (or spans patterns) is it its own step.
  const patternIds=[...new Set(followers.map(item=>item.patternCloudId))],undo=()=>patchPlacementDurations(followers,'from'),redo=()=>patchPlacementDurations(followers,'to'),detail={clips:followers.length};
  let joined=false;
  try{pending=patternIds.length===1?history.beginFollow?.(patternIds[0]):null;joined=!!pending;if(!pending)pending=history.beginExternalStep({kind:'pattern_clip_follow',label});await redo();if(joined)history.finishFollow(pending,{undo,redo,detail});else history.finishExternalStep(pending,{detail,undo,redo});pending=null;renderAll();clientLog('pattern-clip-follow',{clips:followers.length,ms:followers[0].to,joined});}
  catch(error){if(pending)(joined?history.failFollow(pending,error):history.failExternalStep(pending,error));clientLog('pattern-clip-follow',{failed:true,joined,code:error?.code??null,error:String(error?.message||error).slice(0,200)});}
 }).catch(()=>{});
}
/** Guarded saved writes for the follow step: each placement must still have
 * the other side's duration (the step refuses, never overwrites newer data). */
async function patchPlacementDurations(rows,side){
 const other=side==='to'?'from':'to';let sent=0;
 try{for(const item of rows){
  const raw=await savedRaw(),row=raw.placements.find(entry=>entry.id===item.placementId);
  if(!row||Math.abs(Number(row.durationMs)-item[other])>=1||row.windowMs!=null||Number(row.offsetMs)||Math.round(Number(row.repeatCount??1))!==1)throw Object.assign(new Error('The pattern clip changed after its length followed the pattern; it will not be overwritten.'),{dispatched:sent===0,historyNotApplied:sent===0});
  const scope=fileImportScope(),ms=item[side];sent++;
  await engine.session.action('update_pattern_placement',{placement_id:item.placementId,placement:{busId:row.busId||'master',durationMs:ms,...row.loopDurationMs!=null?{loopDurationMs:ms}:{}}},{refresh:false,expectedContext:{projectId:scope.projectId,trackId:scope.trackId,contextVersion:engine.session.contextVersion||0},ifMatch:JSON.stringify(raw.timelineRevision),idempotencyKey:laneMoveKey()});
 }
 const saved=(await savedRaw()).placements;if(rows.some(item=>Math.abs(Number(saved.find(entry=>entry.id===item.placementId)?.durationMs)-item[side])>=1))throw Object.assign(new Error('Freestyle has not confirmed the pattern clip length.'),{operationUncertain:true});
 return{clips:rows.length,side};}
 catch(error){if(sent>0&&error.operationUncertain===undefined)error.operationUncertain=error.explicitRejection!==true;throw error;}
}
/** clips:batch receipts paint at once: the session projects the sent ops and
 * the returned inserted cards; only an insufficient receipt reads canonically. */
async function adoptClipBatchReceipt(payload,context={},{read=()=>engine.refresh()}={}){
 const started=performance.now(),ops=context?.request?.ops;let projected=null;
 if(payload&&Array.isArray(ops)&&['batch','inverse'].includes(context.operation)){try{projected=engine.session.applyClipBatchReceipt?.(payload,{ops})||null;}catch(error){clientLog('clip-batch-projection',{projected:false,error:String(error?.message||error).slice(0,200)});}}
 if(projected){clientLog('clip-batch-projection',{projected:true,operation:context.operation,ops:ops.length,ms:Math.round(performance.now()-started)});return projected;}
 clientLog('clip-batch-projection',{projected:false,operation:context?.operation??null,reason:engine.session.lastClipBatchProjection?.reason??null});
 const result=await read();clientLog('clip-batch-projection',{read:true,ms:Math.round(performance.now()-started)});return result;
}
/** FL-style step label, like the pattern ones: "Undo: Paste clips". */
function clipboardHistoryLabel(plan,redo){const verb={cut:'Cut',duplicate:'Duplicate',paste:'Paste'}[plan?.operation]||'Paste',count=plan?.operation==='cut'?(plan.removedIds?.length||plan.audioOps?.length||1):(plan?.createdIds?.length||1);return`${redo?'Redo':'Undo'}: ${verb} ${count===1?'clip':'clips'}`;}
/** The Undo batch's own undo.inverse_ops is the exact server Redo (null on a replay). */
function clipboardNativeRedo(controller){const ops=controller?.snapshot().undoReceipt?.undo?.inverse_ops;return Array.isArray(ops)&&ops.length?clone(ops):null;}
/** FL-style ghost for each inserted/restored audio clip, painted at keypress. */
function showPendingAudioOps(ops){
 const entries=playlistClipboard.snapshot()?.entries||[],ghosts=[];
 for(const op of ops||[]){if(!['insert','restore'].includes(op?.op)||!Number.isFinite(op.start_ms))continue;
  const source=(project.audioClips||[]).find(clip=>clip.cloudId===op.source_id)||entries.find(entry=>entry.clip?.cloudId===op.id||entry.clip?.cloudId===op.source_id)?.clip;if(!Number.isInteger(source?.track))continue;
  const ghost=showPendingPlaylistClip({track:source.track,beat:op.start_ms*project.bpm/60000},JSON.stringify({name:source.name||'Audio clip',durationSec:op.duration_sec}));if(ghost){ghost.dataset.pendingKind='paste';ghosts.push({ghost,clipId:op.id});}}
 return ghosts;
}
/** Swap each ghost for its real clip once rendered; a failed batch drops them. */
function settlePendingAudioOps(ghosts,controller){const committed=['committed','undone'].includes(controller?.snapshot().status);for(const item of ghosts||[]){if(item.settled)continue;item.settled=true;settlePendingPlaylistClip(item.ghost,committed?item.clipId:null);}}
function clearPendingAudioOps(ghosts){for(const item of ghosts||[])if(!item.settled){item.settled=true;item.ghost.remove();}}
/** Keypress → ghost → acknowledged → painted, for paste / cut / ⌘B timing. */
function audioClipboardTiming(action,plan){const t0=performance.now(),marks=[];return{mark(name){marks.push([name,Math.round(performance.now()-t0)]);},done(controller){const state=controller?.snapshot();clientLog('audio-clipboard-timing',{action,ops:plan?.audioOps?.length||0,marks,totalMs:Math.round(performance.now()-t0),projected:engine.session.lastClipBatchProjection?.projected===true,engineReloadRequired:state?.engineReloadRequired===true});}};}
async function clipboardHistory(redo=false){const record=clipboardHistoryEntry(redo);if(!record||workspaceBusy()||rangeBusy()||sliceBusy()||engine.applying||engine.interacting)return;const {plan}=record,scope=JSON.stringify(fileImportScope()),audioOwner=engine.patternHistory?.beginOwnedAudioChange?.();playlistClipboardBusy=true;
 try{if(record.controller.uncertain)throw new Error('The previous Playlist history result is uncertain. Reload its state; the request will not be repeated.');if(redo){if(record.applied)return;if(record.controller.snapshot().status!=='undone')throw new Error('Playlist Redo needs its unchanged acknowledged Undo receipt.');const controller=new CloudRangeEditController({getProject:()=>project,getScope:fileImportScope,cloudCall:(name,args,options)=>engine.session.call(name,args,options),flush:()=>engine.flush(),onCommitted:adoptClipBatchReceipt});record.historyControllers=[...(record.historyControllers||[]),record.controller];record.controller=controller;const batch=record.batch||{audioOps:plan.audioOps,inverseAudioOps:plan.inverseAudioOps},nativeRedo=clipboardNativeRedo(record.historyControllers.at(-1)),ops=nativeRedo||(plan.operation==='cut'?batch.audioOps:batch.audioOps.map(op=>op.op==='insert'?{...op,op:'restore'}:op));const ghosts=showPendingAudioOps(ops);try{await controller.applyBatch(ops,{inverseOps:batch.inverseAudioOps,serverAuthoredOps:!!nativeRedo||!!batch.serverAuthoredOps,serverAuthoredInverse:!!batch.serverAuthoredInverse});}finally{settlePendingAudioOps(ghosts,controller);}record.applied=true;record.revision=++audioRangeRevision;if(record.afterPattern){project.clips=clone(record.afterPattern);changed();record.revision=audioRangeRevision;await engine.flush();record.afterPattern=clone(project.clips);}}
  else{if(!record.controller.snapshot().canUndo)return;if(record.afterPattern&&JSON.stringify(record.afterPattern)!==JSON.stringify(project.clips))throw new Error('The pattern placements changed after this paste. Inspect them before clipboard undo.');await record.controller.applyInverse();record.applied=false;record.revision=++audioRangeRevision;if(record.afterPattern){if(JSON.stringify(fileImportScope())!==scope)throw new Error('The project changed during clipboard undo.');project.clips=clone(record.beforePattern);changed();record.revision=audioRangeRevision;await engine.flush();record.beforePattern=clone(project.clips);}}
  if(redo)record.afterAudio=clone(project.audioClips||[]);else record.beforeAudio=clone(project.audioClips||[]);record.revision=++audioRangeRevision;bridgeClipboardHistory(record,redo);playlistSelection.sync(project);playlistSelection.select(redo?plan.createdIds:[]);selectedClip=redo?plan.createdIds[0]||null:null;renderAll();toast(clipboardHistoryLabel(plan,redo));
 }catch(error){fail(error);}finally{engine.patternHistory?.endOwnedAudioChange?.(audioOwner);playlistClipboardBusy=false;mixerView?.render();}}
function sliceHistoryController(redo=false){return sliceUncertain()?null:[...sliceRecords()].reverse().find(controller=>controller.state.applied===(redo?'undone':'split'));}
async function sliceHistory(redo=false){
 assertRangeIdle(); if(sliceBusy())throw new Error('Wait for the cloud pattern slice to finish.');if(sliceUncertain())throw new Error('A pattern slice has an uncertain cloud result. Inspect its cloud placements before using slice history.');
 const projectId=engine.projectId,controller=sliceHistoryController(redo);if(!controller)throw new Error('There is no cloud pattern slice to '+(redo?'redo.':'undo.'));
 const result=await controller[redo?'redo':'undo']();const records=patternSlices.get(projectId)||[];patternSlices.set(projectId,[...records.filter(record=>record!==controller),controller]);reportSliceResult(result);
}
async function reloadSliceState(){
 assertRangeIdle(); if(sliceBusy())throw new Error('Wait for the cloud pattern slice to finish.');if(sliceUncertain())throw new Error('Inspect the uncertain cloud slice before restoring its history.');const controller=sliceRecoveryController();if(!controller)throw new Error('There is no committed slice state to reload.');
 sliceReloading=true;document.body.classList.add('atomic-slice-pending');try{const state=await controller.reload();toast('Pattern slice state reloaded from Freestyle.');return state;}finally{sliceReloading=false;document.body.classList.toggle('atomic-slice-pending',sliceBusy());}
}
// A journal can confirm several saved members before the outer Undo/Redo ends.
// Keep that whole operation visible instead of showing a member's Saved status.
let historyUiOperation=null;
function historyFeedbackBusy(){return !!historyUiOperation||!!engine.historyPending||!!engine.patternHistory?.busy;}
function historyFeedbackMessage(message){
 if(historyUiOperation&&historyUiOperation.scope!==JSON.stringify(fileImportScope()))return message;
 if(!historyFeedbackBusy())return message;
 if(historyUiOperation?.error)return historyUiOperation.error;
 const state=engine.patternHistory.snapshot(),receipt=state.receipt;
 if(state.busy&&state.blocked&&['uncertain','rejected','not_sent'].includes(receipt?.status))return receipt.error||state.blocked;
 // QA r3: a track insert / audio import holds the journal but is not an Undo — never say "Undoing edits…".
 const creating=!historyUiOperation&&engine.patternHistory?.operation?.external?.kind;if(creating==='lane_create')return'Inserting track in Freestyle…';if(creating==='audio_import')return'Importing audio into Freestyle…';if(creating)return'Saving in Freestyle…';
 const direction=historyUiOperation?.direction||receipt?.direction;
 // FL hint bar: "Undo: <label>" for the step being saved (or the newest press).
 let pending=null;try{pending=direction?engine.patternHistory?.pendingLabel?.(direction):null;}catch{}if(pending?.label)return`${pending.direction==='redo'?'Redo':'Undo'}: ${pending.label}`;
 return direction==='redo'?'Redoing edits in Freestyle…':direction==='undo'?'Undoing edits in Freestyle…':'Applying history in Freestyle…';
}
function renderHistoryControls(){const disabled=!engine.ready||historyFeedbackBusy();for(const selector of ['#undo','#redo','#piano-undo']){const button=$(selector);if(button){const reason=historyBlockedReason(selector==='#redo'?'redo':'undo');button.disabled=disabled||!!reason;if(reason)button.title=reason;else if(button.title&&button.dataset.blockedTitle==='1')button.removeAttribute('title');button.dataset.blockedTitle=reason?'1':'';button.setAttribute('aria-busy',String(historyFeedbackBusy()));}}}
function paintHistoryFeedback(){renderHistoryControls();if(historyUiOperation&&historyUiOperation.scope!==JSON.stringify(fileImportScope()))return;if(historyFeedbackBusy()){const message=filePickerFeedbackMessage(historyFeedbackMessage(''));$('#status-message').textContent=message;$('#hint').textContent=message;return;}
 // QA round 30: once no history step is saving any more, FL's hint panel names the step just
 // applied ("Undone: …" / "Redone: …") — also when the press finished while others were still
 // saving (that path painted the pending "Undo: …" and returned). Shown once per applied step.
 // Disabelton: the status line never keeps a finished "Undoing edits in Freestyle…" progress message.
 if(!showHistoryHint())for(const id of ['#hint','#status-message'])if(/^(Undoing|Redoing|Applying) .*…$/.test($(id).textContent))$(id).textContent=id==='#hint'?'':'Ready';}
let lastHintedHistory=null;
function showHistoryHint(applied=engine.patternHistory?.lastApplied){if(!applied?.label||applied===lastHintedHistory||!['undo','redo'].includes(applied.direction))return false;lastHintedHistory=applied;$('#hint').textContent=`${applied.direction==='redo'?'Redone':'Undone'}: ${applied.label}`;return true;}
function engineHistoryAction(action){
 {const journal=engine.patternHistory?.snapshot?.();clientLog('undo-dispatch',{action,unsavedEdit:!!(engine.pending||engine.inFlight),route:journal?.hasJournal?'retained_journal':'native_studio_history',blocked:journal?.blocked??null,undoKind:journal?.undoKind??null,redoKind:journal?.redoKind??null,index:journal?.index??null,entries:journal?.entryCount??null});}
 const operation={direction:action==='history_redo'?'redo':'undo',scope:JSON.stringify(fileImportScope()),error:null,appliedBefore:engine.patternHistory?.lastApplied??null};historyUiOperation=operation;paintHistoryFeedback();let succeeded=false;
 return Promise.resolve().then(()=>engine.history(action)).then(result=>{succeeded=true;
  syncPlaylistTrackLeds();
  // FL: ⌘⇧Z of a paste selects the restored clips again.
  const applied=engine.patternHistory?.lastApplied;if(applied&&applied!==operation.appliedBefore&&Array.isArray(applied.selectIds)&&applied.selectIds.length){try{const ids=applied.selectIds.map(cloudId=>allClips().find(clip=>clip.cloudId===cloudId||clip.id===cloudId)?.id).filter(Boolean);if(ids.length){playlistSelection.sync(project);playlistSelection.select(ids);selectedClip=ids[0];paintPlaylistSelection();}}catch{}}
  return result;}).catch(error=>{if(operation.scope!==JSON.stringify(fileImportScope()))return;if(historyUiOperation===operation)operation.error=error.message||String(error);fail(error);}).finally(()=>{if(historyUiOperation!==operation)return;historyUiOperation=null;renderHistoryControls();if(operation.scope!==JSON.stringify(fileImportScope()))return;if(historyFeedbackBusy()){paintHistoryFeedback();return;}if(succeeded){const message=historyCompletedMessage(operation);if(!message)return;toast(message);$('#status-message').textContent=message;{const hint=historyHintMessage(operation,message);$('#hint').textContent=hint;if(hint!==message)lastHintedHistory=engine.patternHistory?.lastApplied;}}});
}
// FL hint bar: "Undo: <step label>" of the exact step this operation applied
// (never the label of a later rapid press that is still reserved).
/** FL's hint bar after each ⌘Z / ⌘⇧Z: "Undone: <action>" / "Redone: <action>". */
function historyHintMessage(operation,fallback){const applied=engine.patternHistory?.lastApplied;return applied&&applied!==operation.appliedBefore&&applied.direction===operation.direction&&applied.label?`${operation.direction==='redo'?'Redone':'Undone'}: ${applied.label}`:fallback;}
function historyCompletedMessage(operation){const history=engine.patternHistory,applied=history?.lastApplied,label=operation.direction==='redo'?'Redo':'Undo';return applied&&applied!==operation.appliedBefore&&applied.direction===operation.direction&&applied.label?`${label}: ${applied.label}`:`${label} completed in Freestyle`;}
// True when this press would reach the retained journal now (mirrors the
// routing order of undoStep/redoStep; any other owner keeps its own path).
function historyJournalRoute(direction){
 const redo=direction==='redo';
 try{const ordered=historyRouteOwner(direction)==='journal';if(clipboardUncertain()||!ordered&&(redo?audioClipMutes.canRedo(audioClipMuteContext()):audioClipMutes.canUndo(audioClipMuteContext())))return false;
  if(!redo&&(!ordered&&regionEffects?.canUndo()||regionEffects?.historyEntry()?.controller.uncertain||regionEffects?.historyEntry()?.controller.state.jobId))return false;
  if(!ordered&&(audioSliceHistoryEntry(redo?'redo':'undo')||(redo?clipboardHistoryEntry(true)&&!clipboardHistoryEntry(true).applied:clipboardHistoryEntry()?.applied)))return false;
  if(workspaceBusy()||rangeBusy()||rangeEdits?.blocksHistory()||sliceBusy()||sliceOwnsHistory(redo))return false;
  if(mixerQueue?.busy||restMixer?.busy||engine.pending||engine.sending||engine.applying||engine.interacting||!engine.ready)return false;
  const journal=engine.patternHistory?.snapshot?.();return !!journal?.hasJournal&&(redo?journal.canRedo:journal.canUndo);}catch{return false;}
}
// FL: every press shows its step immediately, chained on the optimistic state
// of the presses before it; the guarded saved writes then run in order below.
let lastHistoryPress=null;
function reserveHistoryPress(direction){
 const history=engine.patternHistory;if(typeof history?.reserve!=='function'||duplicateQueueDepth)return null;
 const chained=historyQueueDepth>0;if(chained?!(lastHistoryPress?.token&&lastHistoryPress.epoch===historyQueueEpoch&&(lastHistoryPress.token.consumed||history.reserved.includes(lastHistoryPress.token))):!historyJournalRoute(direction))return null;
 let token=null;try{token=history.reserve(direction);}catch{token=null;}
 if(token){const message=`${direction==='redo'?'Redo':'Undo'}: ${token.label}`;toast(message);$('#hint').textContent=message;}
 return token;
}
// FL performs every Undo/Redo press. Presses that overlap a running step are
// queued and run strictly in order, each through the complete guarded step
// below (never concurrently). A step that fails cancels the presses queued
// behind it, and a project/context change discards them.
const HISTORY_QUEUE_LIMIT=32;let historyQueue=Promise.resolve(),historyQueueDepth=0,historyQueueEpoch=0;
function queueHistoryStep(direction){
 if(historyQueueDepth>=HISTORY_QUEUE_LIMIT){clientLog('undo-queue',{event:'dropped_limit',direction,depth:historyQueueDepth});paintHistoryFeedback();return Promise.resolve();}
 const token=reserveHistoryPress(direction),epoch=historyQueueEpoch,scope=JSON.stringify(fileImportScope()),queuedAt=Date.now();lastHistoryPress={token,epoch};historyQueueDepth++;clientLog('undo-queue',{event:'queued',direction,depth:historyQueueDepth,optimistic:!!token,focus:document.activeElement?.tagName||null,inDialog:!!document.activeElement?.closest?.('dialog[open]')});
 const step=()=>{if(epoch!==historyQueueEpoch||scope!==JSON.stringify(fileImportScope())){clientLog('undo-queue',{event:'cancelled',direction,reason:epoch!==historyQueueEpoch?'earlier_step_failed':'project_changed'});if(token&&engine.patternHistory.reserved?.includes(token))engine.patternHistory.rollbackReserved('cancelled');return;}const before=lastOperationError,started=Date.now(),journal=engine.patternHistory?.snapshot?.();clientLog('undo-queue',{event:'start',direction,waitedMs:started-queuedAt,depth:historyQueueDepth,journal:journal?{hasJournal:journal.hasJournal,canUndo:journal.canUndo,canRedo:journal.canRedo,index:journal.index,entries:journal.entryCount,undoKind:journal.undoKind,redoKind:journal.redoKind,blocked:journal.blocked}:null,workspaceBusy:workspaceBusy()});let owner=null;const run=()=>{owner=historyRouteOwner(direction);return direction==='redo'?redoStep(owner):undoStep(owner);};return Promise.resolve(historyStepWaits()?waitForMixerSaves().then(run):run()).then(()=>{let failed=lastOperationError!==before;if(token&&!token.consumed&&engine.patternHistory.reserved?.includes(token)){engine.patternHistory.rollbackReserved('not_applied');failed=true;}if(!failed)historyRouteApplied(direction,owner);clientLog('undo-queue',{event:failed?'failed':'done',optimistic:!!token,direction,ms:Date.now()-started,error:failed?String(lastOperationError?.message||'').slice(0,240):null,status:String($('#status-message')?.textContent||'').slice(0,160),toast:String($('#toast')?.textContent||'').slice(0,160)});if(failed)historyQueueEpoch++;});};
 const run=(historyQueueDepth===1&&!duplicateQueueDepth?new Promise(resolve=>resolve(step())):Promise.all([historyQueue,duplicateQueue]).then(step)).finally(()=>{historyQueueDepth--;/* Disabelton: refresh the status line once the queue drains (no stale progress text) */if(!historyQueueDepth)queueMicrotask(()=>{try{if(!historyFeedbackBusy())paintHistoryFeedback();}catch{}});});
 historyQueue=run.catch(()=>{});return run;
}
// A Mixer gesture, pattern slice, Insert track or other cloud edit released
// just before Cmd+Z is still saving: let it settle (bounded) so it becomes the
// step this Undo reverts instead of a busy refusal (FL queues every press).
// Journaled creations (Insert track, drops/imports, clones) finish first; owners with
// their own receipt history (audio slice, clipboard, region effects) keep their guards.
function historyStepWaits(){return !!(mixerQueue?.busy||restMixer?.busy||sliceBusy()||engine.patternHistory?.externalPending||(engine.patternHistory?.busy&&!engine.historyPending)||laneMoveBusy||laneCreate?.busy||laneCreateDialog?.busy||fileDrop?.busy||audioImportBusy||importEditQueue.length>0||playlistClonePending||historyEditInFlight()||(Number(globalThis.ablPendingHistorySteps)||0)>0);}
// Round 9: any other in-flight cloud edit also settles first, so a queued
// Cmd+Z applies after it lands instead of a "Wait for…" refusal that drops it.
// Owners with their own receipt history (Playlist clipboard, audio slice, clip
// mute, region effect, sample editor, timing map) also settle first; the press
// then routes to that owner's retained Undo, exactly as if pressed after it.
function historyEditInFlight(){return eqEditsInFlight()||rackClipboardBusy||rackMembershipBusy&&!rackMembershipLocalCommit||rackRegistrationBusy||samplePlacementBusy||playlistClipboardBusy||audioSliceBusy()||!!audioClipMutes?.busy||!!regionEffects?.busy||!!sampleEditor?.busy||timingMap?.operation?.kind==='write'||!!rackGraph?.busy||!!cloudLibrary?.writeBusy||!!sliceReloading;}
// Owners signal when their in-flight edit settles, so a queued press starts at
// once (the 25 ms poll is only the fallback for owners without a signal).
let historySettleWaiters=[];
function historyEditSettled(){const waiters=historySettleWaiters;historySettleWaiters=[];for(const resolve of waiters)resolve();}
function nextHistorySettle(){return new Promise(resolve=>historySettleWaiters.push(resolve));}
// Longest an Undo/Redo waits behind a saving step before giving up (tunable for diagnostics/tests).
let historyStepWaitMs=15000;
async function waitForMixerSaves(limitMs=historyStepWaitMs){for(let turn=0;turn<200&&historyStepWaits();turn++)await Promise.resolve();if(!historyStepWaits())return;const started=Date.now();while(historyStepWaits()&&Date.now()-started<limitMs)await Promise.race([nextHistorySettle(),new Promise(resolve=>setTimeout(resolve,25))]);await new Promise(resolve=>setTimeout(resolve,0));}
// Round 14: FL keeps ONE ordered history. Owners keep their own guarded
// stacks (journal: pattern/placement/rack/mixer/automation/plugin steps;
// 'audio': clipboard, audio slice, clip mute, gated by audioRangeRevision),
// and this line orders them: Undo takes the newest done step, Redo the newest
// undone step, and any new step clears every owner's redo tail.
const historyLine={done:[],undone:[],project:null},historySeenJournal=new WeakSet();
function historyLineScope(){const scope=engine.projectId||null;if(historyLine.project!==scope){historyLine.done=[];historyLine.undone=[];historyLine.project=scope;}}
function historyNewStep(owner){
 historyLineScope();historyLine.done.push(owner);if(historyLine.done.length>300)historyLine.done.shift();const dropped=historyLine.undone.length;historyLine.undone=[];
 if(owner!=='journal')engine.patternHistory?.dropRedo?.('other_owner_step');
 if(owner!=='audio'){for(const record of playlistClipboardRecords)if(!record.applied&&!record.abandoned&&record.controller.snapshot().status==='undone')record.abandoned=true;for(const entry of audioSlices)if(entry.controller.snapshot().status==='undone')entry.revision=null;const mute=audioClipMutes.entries.at(-1);if(mute?.status==='undone')audioClipMutes.entries.pop();}
 clientLog('history-order',{event:'new',owner,done:historyLine.done.length,droppedRedo:dropped});
}
function historyJournalObserved(){const history=engine.patternHistory,top=history?.entries?.[history.index-1];if(!top||historySeenJournal.has(top))return;for(const entry of history.entries)historySeenJournal.add(entry);historyNewStep('journal');}
/** The owner that holds the step this press applies, or null (no ordered
 * knowledge: the legacy owner routing below decides). */
function historyRouteOwner(direction){
 historyLineScope();const tag=direction==='redo'?historyLine.undone.at(-1):historyLine.done.at(-1);if(tag!=='journal')return tag??null;
 const state=engine.patternHistory?.snapshot?.();return state&&!state.blocked&&(direction==='redo'?state.canRedo:state.canUndo)?'journal':null;
}
function historyRouteApplied(direction,owner){if(!owner)return;const from=direction==='redo'?historyLine.undone:historyLine.done,to=direction==='redo'?historyLine.done:historyLine.undone;if(from.at(-1)===owner){from.pop();to.push(owner);}}
/* Disabelton (Live): ⌘Z / ⇧⌘Z with nothing retained in ANY history owner is a silent no-op (logged, no error toast). Only when fully idle; a blocked journal or any pending/queued edit still goes through the normal step and its messages. */
function historyEmpty(direction){try{if(historyQueueDepth||duplicateQueueDepth||historyStepWaits()||workspaceBusy()||engine.pending||engine.inFlight||engine.applying||engine.interacting||rangeBusy()||sliceBusy()||rangeEdits?.blocksHistory?.()||clipboardUncertain())return false;const redoing=direction==='redo',h=engine.patternHistory;if(!h||h.blocked||h.busy||h.externalPending||h.reserved?.length||h.entries?.[redoing?h.index:h.index-1])return false;/* without a retained journal, only a Studio API project has no native history step (cloud-engine.js history_empty) */const snap=h.snapshot?.();if(!snap||(redoing?snap.canRedo:snap.canUndo)||!snap.hasJournal&&engine.session?.rawState?.studioApi!==true)return false;if(historyRouteOwner(direction)!==null)return false;if(redoing?audioClipMutes.canRedo(audioClipMuteContext()):audioClipMutes.canUndo(audioClipMuteContext())||regionEffects?.canUndo?.())return false;if(audioSliceHistoryEntry(direction)||sliceOwnsHistory(redoing)||(redoing?clipboardHistoryEntry(true)&&!clipboardHistoryEntry(true).applied:clipboardHistoryEntry()?.applied))return false;return true;}catch{return false;}}
/* QA r5: Edit ▸ Undo/Redo and the history buttons offer only what will succeed. A blocked journal refuses every
   step it owns, so with no other owner (audio-clip mutes, region effects, audio slices, clipboard) able to take
   the press, the item is disabled and titled with the blocked reason instead of offering a refused Undo. */
function historyOtherOwner(direction){const redo=direction==='redo';try{const ctx=audioClipMuteContext();return !!((redo?audioClipMutes.canRedo(ctx):audioClipMutes.canUndo(ctx))||!redo&&regionEffects?.canUndo?.()||audioSliceHistoryEntry(direction)||(redo?clipboardHistoryEntry(true)&&!clipboardHistoryEntry(true).applied:clipboardHistoryEntry()?.applied));}catch{return false;}}
function historyBlockedReason(direction){const h=engine.patternHistory;if(!h?.blocked||historyOtherOwner(direction))return null;return typeof h.blocked==='string'?h.blocked:'History is blocked until the uncertain edit is inspected.';}
function historyCanStep(direction){if(!engine.ready||historyBlockedReason(direction))return false;return !historyEmpty(direction);}
function undo(){if(historyEmpty('undo')){clientLog('undo-queue',{event:'empty',direction:'undo'});$('#status-message').textContent='Nothing to undo';return Promise.resolve();}return queueHistoryStep('undo');}
function redo(){if(historyEmpty('redo')){clientLog('undo-queue',{event:'empty',direction:'redo'});$('#status-message').textContent='Nothing to redo';return Promise.resolve();}return queueHistoryStep('redo');}
function undoStep(owner=null){const ordered=owner==='journal';if(clipboardUncertain())return Promise.resolve(toast('Reload Playlist clipboard state before using Undo.'));if(!ordered&&audioClipMutes.canUndo(audioClipMuteContext())){if(workspaceBusy())return Promise.resolve(toast('Wait for the current cloud operation to finish.'));return audioClipMuteHistoryStep('undo').catch(fail);}if(!ordered&&regionEffects?.canUndo()){if(workspaceBusy())return Promise.resolve(toast('Wait for the current region effect.'));return regionEffects.undoLast().catch(fail);}if(regionEffects?.historyEntry()?.controller.uncertain||regionEffects?.historyEntry()?.controller.state.jobId)return Promise.resolve(toast('Inspect the pending region effect before using other history.'));if(!ordered&&audioSliceHistoryEntry('undo')){if(workspaceBusy())return Promise.resolve(toast('Wait for the current audio slice.'));return undoAudioSlice().catch(fail);}if(!ordered&&!workspaceBusy()&&!rangeBusy()&&!sliceBusy()&&!engine.applying&&clipboardHistoryEntry()?.applied)return clipboardHistory();if(workspaceBusy()){toast('Wait for the current cloud operation to finish.');return Promise.resolve();}if(rangeBusy()||rangeEdits?.blocksHistory()){toast('Use Edit → Undo audio range for the retained audio range receipt.');return Promise.resolve();}if(sliceBusy()){toast('Wait for the cloud pattern slice to finish.');return Promise.resolve();}if(sliceOwnsHistory(false)){return sliceHistory().catch(fail);}try{requireUiFeature('native_undo',{localHistory:{undo:!!engine.pending||!!engine.applying||engine.patternHistory.snapshot().canUndo}});}catch(error){return Promise.resolve(fail(error));}return engineHistoryAction('history_undo');}
function redoStep(owner=null){const ordered=owner==='journal';if(clipboardUncertain())return Promise.resolve(toast('Reload Playlist clipboard state before using Redo.'));if(!ordered&&audioClipMutes.canRedo(audioClipMuteContext())){if(workspaceBusy())return Promise.resolve(toast('Wait for the current cloud operation to finish.'));return audioClipMuteHistoryStep('redo').catch(fail);}if(!ordered&&audioSliceHistoryEntry('redo')){if(workspaceBusy())return Promise.resolve(toast('Wait for the current audio slice.'));return redoAudioSlice().catch(fail);}if(!ordered&&!workspaceBusy()&&!rangeBusy()&&!sliceBusy()&&!engine.applying&&clipboardHistoryEntry(true)&&!clipboardHistoryEntry(true).applied)return clipboardHistory(true);if(workspaceBusy()){toast('Wait for the current cloud operation to finish.');return Promise.resolve();}if(rangeBusy()||rangeEdits?.blocksHistory()){toast('Audio range history uses its explicit Undo audio range control.');return Promise.resolve();}if(sliceBusy()){toast('Wait for the cloud pattern slice to finish.');return Promise.resolve();}if(sliceOwnsHistory(true)){return sliceHistory(true).catch(fail);}try{requireUiFeature('native_redo',{localHistory:{redo:!!engine.pending||!!engine.applying||engine.patternHistory.snapshot().canRedo}});}catch(error){return Promise.resolve(fail(error));}return engineHistoryAction('history_redo');}
function reportSliceResult(state){const warning=state.refreshError||state.checkpointError;toast(warning?`Pattern slice ${state.applied||state.status}. ${warning}`:state.applied==='undone'?'Pattern slice undone in Freestyle.':'Pattern sliced in Freestyle.');}
async function sliceAudioClip(clip,beat){
 if(!playlistEditable())return;finishPointerInteraction();
 if(audioSlices.some(entry=>entry.projectId===engine.projectId&&entry.controller.snapshot().needsInspection))throw new Error('Reload audio slice state from Edit before another slice. The previous request will not repeat.');
 const entry={projectId:engine.projectId,revision:null,controller:new AudioSliceController({getProject:()=>project,getScope:fileImportScope,flush:()=>engine.flush(),cloudCall:(name,args,options)=>engine.session.call(name,args,options),refresh:(payload,context)=>payload?adoptClipBatchReceipt(payload,context,{read:()=>engine.session.refresh()}):engine.session.refresh(),onChange:()=>{document.body.classList.toggle('audio-slice-pending',audioSliceBusy());mixerView?.render();if(!audioSliceBusy())historyEditSettled();}})};
 audioSlices.push(entry);while(audioSlices.length>32&&!audioSlices[0].controller.busy)audioSlices.shift();
 const audioOwner=engine.patternHistory?.beginOwnedAudioChange?.();
 try{const state=await entry.controller.split({clipId:clip.id,beat});if(state.confirmed||state.applied)historyNewStep('audio');if(!state.detached&&state.confirmed){playlistSelection.sync(project);playlistSelection.select([state.plan.clipId,state.plan.childId]);selectedClip=state.plan.clipId;paintPlaylistSelection();}toast(state.status==='noop'?'The cursor does not leave two audible audio pieces.':state.confirmed?(state.receipt?.engine_reload_required?'Audio slice saved. The live engine still needs to reload it.':'Audio sliced in Freestyle.'):state.error||'Audio slice acknowledged. Reload audio slice state to confirm its timing.');return state;}
 finally{engine.patternHistory?.endOwnedAudioChange?.(audioOwner);const state=entry.controller.snapshot();if(!state.detached&&(state.applied||state.needsInspection)&&entry.revision===null)entry.revision=++audioRangeRevision;}
}
async function undoAudioSlice(){
 const entry=audioSliceHistoryEntry('undo');if(workspaceBusy()||rangeBusy()||sliceBusy())throw new Error('Wait for the current cloud operation.');if(!entry||!entry.controller.snapshot().canUndo)throw new Error('Reload the unchanged audio slice state before undoing. An uncertain request cannot be repeated or undone by guessing.');
 const audioOwner=engine.patternHistory?.beginOwnedAudioChange?.();let state;try{state=await entry.controller.undo();}finally{engine.patternHistory?.endOwnedAudioChange?.(audioOwner);}if(!state.detached){entry.revision=++audioRangeRevision;playlistSelection.sync(project);playlistSelection.select([state.plan.clipId]);selectedClip=state.plan.clipId;paintPlaylistSelection();}toast(state.confirmed?(state.receipt?.engine_reload_required?'Undo: Slice clip (saved; the live engine is resyncing)':'Undo: Slice clip'):state.error||'Audio undo acknowledged. Reload its state to confirm.');return state;
}
async function redoAudioSlice(){
 const entry=audioSliceHistoryEntry('redo');if(workspaceBusy()||rangeBusy()||sliceBusy())throw new Error('Wait for the current cloud operation.');const before=entry?.controller.snapshot();if(!before?.canRedo)throw new Error(before?.redoUnavailableReason||'Reload the unchanged acknowledged audio Undo before redoing. An uncertain request cannot be repeated.');
 const audioOwner=engine.patternHistory?.beginOwnedAudioChange?.();let state;try{state=await entry.controller.redo();}finally{engine.patternHistory?.endOwnedAudioChange?.(audioOwner);}if(!state.detached){entry.revision=++audioRangeRevision;if(state.confirmed){playlistSelection.sync(project);playlistSelection.select([state.plan.clipId,state.plan.childId]);selectedClip=state.plan.clipId;paintPlaylistSelection();}}toast(state.confirmed?(state.receipt?.engine_reload_required?'Redo: Slice clip (saved; the live engine is resyncing)':'Redo: Slice clip'):state.error||'Audio Redo acknowledged. Reload its state to confirm.');return state;
}
async function reloadAudioSlice(){
 const entry=audioSliceEntry();if(workspaceBusy()||rangeBusy()||sliceBusy())throw new Error('Wait for the current cloud operation.');if(!entry)throw new Error('There is no retained audio slice to inspect.');const state=await entry.controller.reload();toast(state.uncertain?'Audio state reloaded. The previous slice remains uncertain and will not be retried.':'Audio slice state reloaded. No edit was repeated.');return state;
}
async function slicePatternPlacement(clip,beat){
 if(!playlistEditable())return;finishPointerInteraction();
 const records=sliceRecords();if(records.some(controller=>controller.snapshot().status==='uncertain'))throw new Error('The previous pattern slice has an uncertain cloud result. Inspect its cloud placements before slicing again.');
 selectedClip=clip.id;playlistSelection.select([clip.id]);const capturedId=clip.id,projectId=engine.projectId;
 const controller=createFLPatternSplitController({engine,getProject:()=>project,getPlacement:()=>findClip(capturedId),getCutBeat:()=>beat,onChange:state=>{document.body.classList.toggle('atomic-slice-pending',sliceBusy());if(state.busy)$('#status-message').textContent=state.operation==='undo'?'Undoing pattern slice in Freestyle…':state.operation==='redo'?'Redoing pattern slice in Freestyle…':'Slicing pattern in Freestyle…';}});
 // FL: a slice is one ordinary Undo step in the project journal. Begin before
 // the atomic write so its receipt refresh is this step, never "changed outside".
 const history=engine.patternHistory,pending=history.beginExternalStep({kind:'pattern_slice',label:'Slice pattern clip'});
 patternSlices.set(projectId,[...records,controller]);
 try{const state=await controller.split();if(state.applied==='split'){patternSlices.set(projectId,[...(patternSlices.get(projectId)||[]).filter(record=>record!==controller&&record.state.applied!=='undone'),controller]);controller.journaled=history.finishExternalStep(pending,patternSliceStep(controller))===true;}else history.failExternalStep(pending,{message:'The pattern slice was not applied.'});reportSliceResult(state);return state;}
 catch(error){history.failExternalStep(pending,controller.state.status==='uncertain'?Object.assign(error,{operationUncertain:true}):error);if(!controller.state.applied&&['idle','failed'].includes(controller.state.status))patternSlices.set(projectId,(patternSlices.get(projectId)||[]).filter(record=>record!==controller));throw error;}
}
/** Journal step for one acknowledged atomic slice: Undo/Redo reuse its native
 * receipt (same child identity); the preview shows the merged/split clip at once. */
function patternSliceStep(controller){
 const receipt=controller.state.receipt,refused=error=>{if(controller.state.status!=='uncertain')error.dispatched=false;return error;};
 const run=async direction=>{let state;try{state=await controller[direction]();}catch(error){throw refused(error);}if(state.refreshError)await engine.refresh().catch(()=>{});playlistSelection.sync(project);return{placementId:receipt.placementId,childId:receipt.childId,applied:state.applied};};
 const previewModel=(direction,raw)=>{const parent=raw.placements.find(row=>row.id===receipt.placementId);if(!parent)return false;
  if(direction==='undo'){if(!receipt.before||!Object.hasOwn(receipt.before,'windowMs'))return false;parent.windowMs=receipt.before.windowMs;raw.placements=raw.placements.filter(row=>row.id!==receipt.childId);return true;}
  if(!receipt.left||!receipt.right)return false;raw.placements=[...raw.placements.filter(row=>row.id!==receipt.childId).map(row=>row.id===receipt.placementId?structuredClone(receipt.left):row),structuredClone(receipt.right)];return true;};
 return{detail:{placementId:receipt.placementId,childId:receipt.childId,cutMs:receipt.cutMs},undo:()=>run('undo'),redo:()=>run('redo'),previewModel};
}
// Journaled slices leave Undo/Redo routing to the journal. Only an in-flight or
// uncertain slice, or an unjournaled receipt that can still apply, owns it here.
function sliceOwnsHistory(redo=false){if(sliceRecords().some(controller=>{const state=controller.snapshot();return state.busy||state.status==='uncertain';}))return true;const controller=sliceHistoryController(redo);return !!controller&&!controller.journaled;}
function selectPattern(id){clearPianoSelection();stepPage=0;engine.selectedPattern=id;project.selectedPattern=id;selectedNote=null;const p=pattern();selectedChannel=Object.keys(p.notes||{}).find(k=>p.notes[k].length)||Object.keys(p.cloudSources||{})[0]||selectedChannel;syncRackFocus();renderAll();}
function addPattern(){const applied=edit(()=>{const p={id:'local-'+uid(),name:`Pattern ${project.patterns.length+1}`,bars:1,steps:{},notes:{}};project.patterns=project.patterns.filter(p=>p.id!=='empty');project.patterns.push(p);project.selectedPattern=p.id;});if(applied)toast('New pattern. Add steps or draw notes.');}
function uiFeature(feature,options={}){return studioApiFeatureAvailability(feature,{project,...options});}
function requireUiFeature(feature,options={}){return assertStudioApiFeature(feature,{project,...options});}
function metronomeState(){return engine.metronome?.snapshot?.()??{status:'idle',actual:null,busy:false,available:null,error:null};}
function renderMetronome(){const state=metronomeState(),button=$('#metronome'),availability=uiFeature('metronome'),key=JSON.stringify([state.actual,state.status,state.busy,state.error,engine.ready,engine.loading,availability.enabled]);if(key===metronomeRenderKey)return;metronomeRenderKey=key;button.classList.toggle('lit',state.actual===true);button.setAttribute('aria-pressed',state.actual===null?'mixed':String(state.actual===true));button.setAttribute('aria-busy',String(!!state.busy));button.dataset.metronomeStatus=state.status||'idle';button.disabled=!!state.busy||!engine.ready||!!engine.loading||!availability.enabled;button.title=!availability.enabled?availability.reason:!engine.ready?'Connect a Freestyle project to use the metronome':state.busy?'Updating metronome in Freestyle…':state.error?`Metronome: ${state.error}`:state.actual===null?'Metronome state is unknown; read and toggle in Freestyle':`Metronome ${state.actual?'on':'off'}`;}
async function toggleMetronomeUi(){if(!engine.ready||engine.loading)return toast('Select or create a Freestyle project first.');if(engine.interacting||engine.applying||rangeBusy()||sliceBusy()||cloudLibrary?.writeBusy)return toast('Finish the current edit before changing the metronome.');try{requireUiFeature('metronome');const pending=engine.toggleMetronome();renderMetronome();const state=await pending;renderMetronome();return state;}catch(error){renderMetronome();fail(error);return null;}}
function renderSummary(){$('#project-title').textContent=project.title;$('#project-summary').textContent=`${countLabel(project.channels.length,'channel')} · ${countLabel(project.patterns.length,'pattern')} · ${countLabel(allClips().length,'clip')}`;$('#tempo').value=project.bpm;$('#tempo').disabled=project.cloud?.rawProject?.timingMap?.isConstantTempo===false;$('#tempo').title=$('#tempo').disabled?'Tempo map active · Options → Tempo and time signatures':'Tempo (BPM)';document.title=`${project.title} — Disabelton`;renderMetronome();renderHistoryControls();}
function patternSvg(p,color='currentColor',clip){return patternPreviewSvg(p,{color,clip,bpm:project.bpm});}
function renderPatterns(){const p=pattern();$('#pattern-select').innerHTML=project.patterns.map(p=>`<option value="${esc(p.id)}" ${p.id===project.selectedPattern?'selected':''}>${esc(p.name)}</option>`).join('');$('#playlist-pattern-title').textContent='▸ '+p.name;
 $('#pattern-picker').innerHTML=project.patterns.map((p,i)=>`<div draggable="true" class="pattern-tile ${p.id===project.selectedPattern?'selected':''}" data-pattern="${esc(p.id)}" style="--clip-color:${colors[i%colors.length]}">▸ ${esc(p.name)}${patternSvg(p)}</div>`).join('');
 $$('#pattern-picker .pattern-tile').forEach(el=>{el.onclick=()=>selectPattern(el.dataset.pattern);el.ondblclick=()=>renamePattern(el.dataset.pattern);el.ondragstart=e=>e.dataTransfer.setData('application/vegetable-pattern',el.dataset.pattern);el.oncontextmenu=e=>{e.preventDefault();patternMenu(e,el.dataset.pattern);};});
}
function currentProjectRack(){
 if(!engine.ready)return null;
 if(rackViewCache?.project===project&&rackViewCache.revision===audioRangeRevision&&rackViewCache.pattern===project.selectedPattern)return rackViewCache.view;
 let view=null;try{view=projectRackView(project);rackViewError=null;}catch(error){rackViewError=error.message;}
 rackViewCache={project,revision:audioRangeRevision,pattern:project.selectedPattern,view};return view;
}
function rackDisplayRows(){const view=currentProjectRack();if(!view)return rackPatternChannels().map(channel=>({id:channel.id,channel,model:null}));return view.rows.map(row=>({id:row.id,channel:row.current.status==='bound'?project.channels.find(channel=>channel.id===row.current.membership.channelId):null,model:row}));}
function syncRackFocus(){const row=currentProjectRack()?.rows.find(row=>row.id===selectedRackRow);if(row?.current.status==='bound'&&row.current.membership.channelId)selectedChannel=row.current.membership.channelId;}
function rackRowForChannel(id){return rackDisplayRows().find(row=>row.channel?.id===id)?.id??id;}
function rackFocusedRow(){const rows=rackDisplayRows();return rows.some(row=>row.id===selectedRackRow)?selectedRackRow:rows.find(row=>row.channel?.id===selectedChannel)?.id??null;}
/** Right-click on a rack channel name: the channel menu; a project instrument
 * not used in this pattern gets its own menu (never the browser's). */
function rackRowMenu(e,rowId){
 const row=rackDisplayRows().find(row=>row.id===rowId);if(!row)return;if(row.channel)return channelMenu(e,row.channel.id);
 if(!rackSelector.ids.has(rowId))rackSelector.focus(rowId);
 menu(e,[{label:row.model?.name||'Project instrument',disabled:true},null,['Use in this pattern','',()=>activateRackRow(rowId),!row.model],['Select all','⌘A',()=>rackSelector.selectAll()]]);
}
function activateRackRow(rowId){
 const row=rackDisplayRows().find(row=>row.id===rowId);if(!row?.model||row.channel)return;
 const templates=row.model.memberships.map(member=>({patternId:member.patternId,source:member.source}));
 if(!templates.length&&row.model.binding?.kind==='plugin')templates.push({patternId:null,source:{...clone(row.model.binding),...row.model.name?{name:row.model.name}:{}}});
 if(!templates.length)return toast('This channel needs its original instrument binding before it can be used.');
 const context={project:engine.projectId,track:engine.session.trackId,load:engine.loadVersion||0,context:engine.session.contextVersion||0,pattern:pattern().id},before=clone(pattern().cloudRaw),target=pattern().id,attemptKey=JSON.stringify([engine.projectId,target,rowId]),prior=rackMembershipAttempts.get(attemptKey);if(prior?.status==='uncertain'&&(engine.session.canonicalProjectReadCompleted||0)<=prior.readSequence)return toast('Reload the cloud project before trying this channel again.');
 const d=dialog('Use channel in pattern',`<p>Use ${esc(row.model.name||'this instrument')} in ${esc(pattern().name)}.</p><label>Channel settings from<select class="rack-template">${templates.map((item,index)=>`<option value="${index}">${esc(project.patterns.find(pattern=>pattern.id===item.patternId)?.name||'Instrument lane')}</option>`).join('')}</select></label><p>The new score starts empty.</p><button class="primary rack-use-channel">Use channel</button>`);
 d.querySelector('.rack-use-channel').onclick=async()=>{
  const button=d.querySelector('.rack-use-channel');button.disabled=true;let attempt=null;
  try{
   await engine.flush();const current={project:engine.projectId,track:engine.session.trackId,load:engine.loadVersion||0,context:engine.session.contextVersion||0,pattern:pattern().id};if(JSON.stringify(current)!==JSON.stringify(context)||JSON.stringify(pattern().cloudRaw)!==JSON.stringify(before))throw new Error('The pattern changed. Reopen this channel before adding its score.');
   const latest=rackDisplayRows().find(row=>row.id===rowId);if(!latest||latest.channel)throw new Error('The channel membership changed. Reload its current score.');
   const source={...clone(templates[Number(d.querySelector('.rack-template').value)].source),id:prior?.source?.id||crypto.randomUUID()};let added;
   if(!edit(()=>{added=attachPatternSource(project,pattern(),source);selectedChannel=added.id;selectedRackRow=rowId;}))return;
   attempt={source:clone(source),status:'sending',readSequence:engine.session.canonicalProjectReadRequested||0};rackMembershipAttempts.set(attemptKey,attempt);await engine.flush();if(engine.projectId!==context.project||pattern().id!==target)throw new Error('The cloud project changed while the channel score was added.');
   const confirmed=rackDisplayRows().find(row=>row.id===rowId);if(!confirmed?.channel||confirmed.model?.current?.membership?.sourceId!==source.id)throw new Error('Freestyle has not confirmed the new channel score. Reload before adding it again.');
   attempt.status='confirmed';selectedChannel=confirmed.channel.id;selectedRackRow=rowId;rackSelector.selection.focus(rowId);renderRack();renderPiano();d.close();toast('Channel ready in this pattern.');
  }catch(error){if(attempt){attempt.status='uncertain';attempt.error=error.message;}fail(error);}finally{if(d.isConnected)button.disabled=attempt?.status==='uncertain';}
 };
}
function rackPatternChannels(){const sourceIds=Object.keys(pattern().cloudSources||{});return sourceIds.length?project.channels.filter(c=>sourceIds.includes(c.id)):project.channels.filter(c=>c.patternSource);}
function rackMissingStepTemplate(row){
 if(row?.channel||row?.model?.kind!=='sample')return{reason:'Choose this channel’s settings before entering steps.'};
 const key=JSON.stringify([engine.projectId,pattern().id,row.id]),prior=rackMembershipAttempts.get(key);
 if(prior?.status==='uncertain'&&(engine.session.canonicalProjectReadCompleted||0)<=prior.readSequence)return{reason:'Reload the cloud project before editing this channel again.'};
 return emptyRackSourceTemplate(row);
}
function rackStepRows(){return $$('#rack .rack-channel').filter(row=>row.querySelector('.step:not(:disabled)')).map(row=>({channelId:row.dataset.channel,steps:rackQueuedSteps(row.dataset.channel,pattern().steps[row.dataset.channel]||Array(Math.max(16,Math.ceil(patternLengthBeats(pattern())*4))).fill(false))}));}
function rackMembershipScope(){return{project:engine.projectId,track:engine.session.trackId,load:engine.loadVersion||0,context:engine.session.contextVersion||0,pattern:pattern().id};}
// Round 12: a held click is judged against the rows/cells it started on. Its
// own source registration finishing, a canonical re-render or a live-mix repaint
// mid-click must not cancel it (FL never drops a clicked step).
let rackStepFrozen=null;
// Only VISIBLE cells (the stroke contract): a row hidden by the Clip View's Drum Rack Fold (display:none,
// a zero rect) is not a target. QA r14: passing hidden rows' zero rects made every Fold step click refuse.
function rackStepCells(){return $$('.rack-channel .step:not(:disabled)').filter(node=>!node.closest('.rack-channel.abl-fold-hidden')).map(node=>{const bounds=node.getBoundingClientRect();return{channelId:node.closest('.rack-channel').dataset.channel,index:Number(node.dataset.step),left:bounds.left,right:bounds.right,top:bounds.top,bottom:bounds.bottom};}).filter(cell=>cell.right>cell.left&&cell.bottom>cell.top);}
/** A gesture's per-cell changes against the rows it started on, so it never
 * writes back a stale whole row (cells it did not touch keep current state). */
// FL: a step toggled off and on again in this session keeps its velocity (its event, pan and pitch are kept by the serializer).
const rackRetiredVelocity=new Map();
function rackGestureChanges(result,initial){const before=new Map((initial||[]).map(row=>[row.channelId,row.steps])),out=[],patternKey=pattern()?.cloudId||pattern()?.id;for(const [id,steps]of result.stepsByChannel){const prior=before.get(id)||[];steps.forEach((value,index)=>{if(!!value===!!prior[index])return;const key=`${patternKey}|${id}|${index}`;if(!value&&typeof prior[index]==='number'&&prior[index]>0){rackRetiredVelocity.delete(key);rackRetiredVelocity.set(key,prior[index]);if(rackRetiredVelocity.size>2048)rackRetiredVelocity.delete(rackRetiredVelocity.keys().next().value);}const kept=value===true?rackRetiredVelocity.get(key):undefined;out.push({rowId:id,index,value:value?(kept??value):false});});}return out;}
function rackSourceRegistered(id){return !!id&&project.channels.some(channel=>channel.id===id&&channel.patternSource&&String(channel.patternId)===String(pattern().id));}
function rackGestureCommit(result,initial=rackStepFrozen?.rows){
 const changes=rackGestureChanges(result,initial);if(!changes.length)return true;
 // While a source registers, or clicks are already queued, or the click hit a
 // row whose source registered but has not re-rendered yet: append in order.
 const rows=rackDisplayRows(),staleRegistered=changes.some(change=>rackSourceRegistered(rackMembershipIds.get(change.rowId))&&!rows.some(row=>row.id===change.rowId&&row.channel));
 if(rackMembershipBusy||rackStepQueue.length||staleRegistered){const reason=rackMembershipBusy?'source-registration':rackStepQueue.length?'queue-pending':'registered-row-stale';rackStepQueue.push(...changes);clientLog('rack-step-queued',{reason,deltas:changes.map(entry=>[entry.rowId,entry.index,!!entry.value]),queued:rackStepQueue.length});applyRackStepOverlay();if(!rackMembershipBusy)queueMicrotask(()=>replayRackSteps().catch(fail));return true;}
 const length=Math.max(16,Math.ceil(patternLengthBeats(pattern())*4)),next=new Map();
 for(const change of changes){if(!next.has(change.rowId))next.set(change.rowId,rackQueuedSteps(change.rowId,pattern().steps[change.rowId]||Array(length).fill(false)).slice());next.get(change.rowId)[change.index]=change.value;}
 return commitRackSteps({...result,stepsByChannel:next});
}
async function commitRackSteps(result){
 if(rackMembershipBusy)return queueRackSteps(result,'source-registration');
 const changed=[...result.stepsByChannel],rows=rackDisplayRows(),missing=changed.map(([id])=>rows.find(row=>row.id===id&&!row.channel)).filter(Boolean);
 clientLog('rack-step-commit',{rows:changed.map(([id,steps])=>[id,steps.map(value=>value?1:0).join('')]),missing:missing.map(row=>row.id),pending:!!engine.pending,inFlight:!!engine.inFlight});
 if(!missing.length){if(result.label)engine.patternHistory?.hintLabel?.(result.label,{kind:'pattern'});const applied=rackEdit(()=>{for(const [id,steps]of changed)pattern().steps[id]=steps;});if(!applied&&result.label)engine.patternHistory?.hintLabel?.(null);if(!applied)clientLog('rack-step-dropped',{reason:'edit-refused',blockers:cloudBlockerReasons()});return applied;}
 if(!rackBaseEditable()||engine.interacting){clientLog('rack-step-dropped',{reason:'membership-not-editable',refusal:rackStepRefusal()});return false;}
 const context=rackMembershipScope(),before=clone(pattern()),templates=new Map(missing.map(row=>[row.id,rackMissingStepTemplate(row)])),attempts=[];
 for(const template of templates.values())if(!template.source)throw new Error(template.reason);
 rackMembershipBusy=true;rackMembershipOverlay=rackStepDeltas(result);applyRackStepOverlay();
 try{
  await engine.flush();if(JSON.stringify(context)!==JSON.stringify(rackMembershipScope())||JSON.stringify(pattern())!==JSON.stringify(before))throw new Error('The pattern changed before step entry finished. Try the current row again.');
  const currentRows=rackDisplayRows(),prepared=clone(project),target=prepared.patterns.find(item=>item.id===context.pattern),sourceForRow=new Map();
  for(const row of missing){
   const current=currentRows.find(item=>item.id===row.id),template=rackMissingStepTemplate(current);if(current?.channel||!template.source||JSON.stringify(template)!==JSON.stringify(templates.get(row.id)))throw new Error('The channel settings changed. Choose the current channel before entering steps.');
   const attemptKey=JSON.stringify([context.project,context.pattern,row.id]),prior=rackMembershipAttempts.get(attemptKey),source=emptyRackSource(current,{id:prior?.source?.id||crypto.randomUUID()}),added=attachPatternSource(prepared,target,source);
   sourceForRow.set(row.id,added.id);rackMembershipIds.set(row.id,added.id);attempts.push({key:attemptKey,rowId:row.id,source:clone(source),status:'prepared',readSequence:engine.session.canonicalProjectReadRequested||0,steps:clone(result.stepsByChannel.get(row.id))});
  }
  for(const [id,steps]of changed){const targetId=sourceForRow.get(id)||id;if(!prepared.channels.some(channel=>channel.id===targetId&&String(channel.patternId)===String(target.id)&&channel.patternSource))throw new Error('The step row has no exact current-pattern source.');target.steps[targetId]=clone(steps);}
  const existing=new Set(project.channels.map(channel=>channel.id));let applied;
  // A channel-menu Fill names its step (one Undo step with the registrations).
  if(result.label)engine.patternHistory?.hintLabel?.(result.label,{kind:'pattern'});
  try{rackMembershipLocalCommit=true;applied=rackEdit(()=>{project.channels.push(...prepared.channels.filter(channel=>!existing.has(channel.id)));Object.assign(pattern(),{cloudSources:target.cloudSources,steps:target.steps,notes:target.notes});});}finally{rackMembershipLocalCommit=false;}
  if(!applied){if(result.label)engine.patternHistory?.hintLabel?.(null);return false;}
  for(const attempt of attempts){attempt.status='sending';rackMembershipAttempts.set(attempt.key,attempt);}
  await engine.flush();
  // A click held while this registration saved defers the confirmed model
  // (engine.interacting); confirm once it is released, never as a false failure.
  for(let wait=0;wait<300&&(rackStepGesture.active||engine.interacting||engine.pending);wait++){if(engine.pending&&!engine.interacting&&!rackStepGesture.active)await engine.flush();else await new Promise(resolve=>setTimeout(resolve,10));}
  // flush() skips adopting the saved model while a click is held; adopt it now.
  engine.settleLocalModel?.();
  if(JSON.stringify(context)!==JSON.stringify(rackMembershipScope()))throw new Error('The cloud project changed while the new step score was saved.');
  for(const attempt of attempts){const confirmed=rackDisplayRows().find(row=>row.id===attempt.rowId),steps=confirmed?.channel&&pattern().steps[confirmed.channel.id];if(!confirmed?.channel||confirmed.model?.current?.membership?.sourceId!==attempt.source.id||!Array.isArray(steps)||steps.length!==attempt.steps.length||steps.some((value,index)=>(value===true?100/128:value)!==(attempt.steps[index]===true?100/128:attempt.steps[index])))/* `true` = the writer's default 100/128, which the read returns as a number */throw new Error('Freestyle has not confirmed the new channel steps. Reload before trying this row again.');attempt.status='confirmed';}
  return true;
 }catch(error){for(const attempt of attempts)if(attempt.status==='sending'){attempt.status='uncertain';attempt.error=error.message;}throw error;}
 finally{rackMembershipBusy=false;rackMembershipOverlay=[];renderRack();if(rackStepQueue.length)queueMicrotask(()=>replayRackSteps().catch(fail));}
}
function rackBaseEditable({allowMembership=false}={}){return !workspaceBusy({ignoreRackMembership:allowMembership})&&!rackClipboardBusy&&engine.ready&&!engine.loading&&!engine.editBlocked&&!rangeBusy()&&!sliceBusy()&&!cloudLibrary?.writeBusy&&!activePianoCancel&&!activePlaylistCancel;}
function rackStepEditable(){return rackBaseEditable({allowMembership:true})&&!rackGraph?.busy&&(!engine.interacting||rackStepGesture.active);}
/** Why a step click cannot start now (diagnostics only). */
function rackStepRefusal(){if(!engine.ready)return'not-ready';if(engine.loading)return'loading';if(engine.editBlocked)return'edit-blocked';if(rackGraph?.busy)return'rack-graph';if(engine.interacting&&!rackStepGesture.active)return'other-gesture';if(activePianoCancel)return'piano-gesture';if(activePlaylistCancel)return'playlist-gesture';const reasons=cloudBlockerReasons().filter(reason=>!['rack-membership','edit-save','pointer-gesture'].includes(reason));return reasons.length?reasons.join(','):(rackClipboardBusy?'rack-clipboard':'unknown');}
// Step toggles made while a first-step source registration is in flight are
// painted at once and replayed (as per-step deltas) once it completes.
const rackStepQueue=[],rackMembershipIds=new Map();let rackRenderDeferred=false,rackMembershipOverlay=[];
// Channel-menu step edits queued behind a saving Undo/Redo: key → the row they
// will write, painted on every rack render until they apply (or roll back).
const rackPendingSteps=new Map();let rackEditQueue=Promise.resolve(),rackEditQueueDepth=0;
function rackQueuedSteps(id,steps){const out=steps.slice();for(const entry of [...rackMembershipOverlay,...rackStepQueue])if(entry.rowId===id||rackMembershipIds.get(entry.rowId)===id)out[entry.index]=entry.value;return out;}
function rackStepDeltas(result){const out=[];for(const [id,steps]of result.stepsByChannel){const current=rackQueuedSteps(id,pattern().steps[id]||[]);steps.forEach((value,index)=>{if(!!value!==!!current[index])out.push({rowId:id,index,value:value?value:false});});}return out;}
function applyRackStepOverlay(){for(const entry of [...rackMembershipOverlay,...rackStepQueue]){const id=rackMembershipIds.get(entry.rowId)||entry.rowId,node=[...document.querySelectorAll('.rack-channel')].find(row=>row.dataset.channel===id||row.dataset.rackRow===entry.rowId)?.querySelector(`.step[data-step="${entry.index}"]`);if(!node)continue;node.classList.toggle('on',!!entry.value);node.setAttribute('aria-pressed',String(!!entry.value));}
 for(const [key,steps]of rackPendingSteps){const row=[...document.querySelectorAll('.rack-channel')].find(node=>node.dataset.channel===key||node.dataset.rackRow===key);for(const cell of row?.querySelectorAll('.step[data-step]')||[]){const on=!!steps[+cell.dataset.step];cell.classList.toggle('on',on);cell.setAttribute('aria-pressed',String(on));}}}
function queueRackSteps(result,reason){const deltas=rackStepDeltas(result);if(!deltas.length)return true;rackStepQueue.push(...deltas);clientLog('rack-step-queued',{reason,deltas:deltas.map(entry=>[entry.rowId,entry.index,!!entry.value]),queued:rackStepQueue.length});applyRackStepOverlay();return true;}
async function replayRackSteps(){
 if(!rackStepQueue.length||rackMembershipBusy)return;const queued=rackStepQueue.splice(0),byRow=new Map(),length=Math.max(16,Math.ceil(patternLengthBeats(pattern())*4)),channelEdits=[],missing=new Map();
 for(const entry of queued){const id=rackMembershipIds.get(entry.rowId)||entry.rowId;if(!byRow.has(id))byRow.set(id,[]);byRow.get(id).push(entry);}
 // A source that is not (or no longer) registered: replay its clicks on the
 // displayed missing row (one new registration), never as a whole-row write
 // onto a stale source id that would erase its earlier steps.
 for(const [id,entries]of byRow){const real=rackSourceRegistered(id);if(real){const steps=(pattern().steps[id]||Array(length).fill(false)).slice();for(const entry of entries)steps[entry.index]=entry.value;channelEdits.push([id,steps]);continue;}for(const entry of entries){const rowId=rackDisplayRows().some(row=>row.id===entry.rowId&&!row.channel)?entry.rowId:id;if(!missing.has(rowId))missing.set(rowId,Array(length).fill(false));missing.get(rowId)[entry.index]=entry.value;}}
 clientLog('rack-step-replay',{rows:[...byRow.keys()],channels:channelEdits.length,stillMissing:[...missing.keys()]});
 if(channelEdits.length&&!rackEdit(()=>{for(const [id,steps]of channelEdits)pattern().steps[id]=steps;})){clientLog('rack-step-dropped',{reason:'replay-edit-refused',blockers:cloudBlockerReasons()});toast('Some step clicks could not be saved; repeat them.');}
 if(missing.size)await commitRackSteps({stepsByChannel:missing});
}
const rackStepGesture=new RackStepGesture({getScope:()=>({project:engine.projectId,track:engine.session.trackId,load:engine.loadVersion||0,context:engine.session.contextVersion||0,pattern:pattern().id,channel:selectedChannel,page:stepPage,filter:$('#channel-filter').value,both:useBothStepButtons}),getRows:()=>rackStepFrozen?clone(rackStepFrozen.rows):rackStepRows(),
 getCells:()=>rackStepFrozen?clone(rackStepFrozen.cells):rackStepCells(),
 getMode:event=>event.button===2||event.ctrlKey&&/Mac/i.test(navigator.platform)?'off':useBothStepButtons?'on':'toggle',isEditable:rackStepEditable,
 onStart:({pointerId,rows})=>{rackStepFrozen={rows:clone(rows),cells:rackStepCells()};engine.interacting=true;activeRackCancel=Object.assign(()=>rackStepGesture.cancel(),{pointerId});for(const node of $$('.rack-channel .step'))rackStepStyles.set(node,{on:node.classList.contains('on'),pressed:node.getAttribute('aria-pressed')});},
 paint:result=>{for(const row of $$('#rack .rack-channel')){const steps=result.stepsByChannel.get(row.dataset.channel);if(!steps)continue;for(const node of row.querySelectorAll('.step')){node.classList.toggle('on',!!steps[Number(node.dataset.step)]);node.setAttribute('aria-pressed',String(!!steps[Number(node.dataset.step)]));}}},
 restore:()=>{for(const [node,before]of rackStepStyles){node.classList.toggle('on',before.on);node.setAttribute('aria-pressed',before.pressed);}rackStepStyles.clear();},
 onFinish:result=>{queueMicrotask(()=>{if(!rackStepGesture.active)rackStepFrozen=null;});if(result?.cancelled)clientLog('rack-step-dropped',{reason:'gesture-cancelled',error:result.error?.message||null});activeRackCancel=null;engine.interacting=false;if(rackRenderDeferred){rackRenderDeferred=false;queueMicrotask(()=>renderRack());}const element=rackStepElement,pointerId=rackStepPointer;rackStepElement=null;rackStepPointer=null;if(element){element.onpointermove=element.onpointerup=element.onpointercancel=element.onlostpointercapture=null;try{if(element.hasPointerCapture?.(pointerId))element.releasePointerCapture(pointerId);}catch{}}},
 commit:rackGestureCommit,onError:fail});
function beginRackStep(event,element){
 // Logic Step Sequencer: left click/drag paints steps; right-click opens the step menu (contextmenu).
 if(activeRackKnob||event.isPrimary===false||rackStepGesture.active||event.button!==0)return;activePlaylistCancel?.();activePianoCancel?.();event.preventDefault();event.stopPropagation();rackStepElement=element;rackStepPointer=event.pointerId;
 clientLog('rack-step-down',{row:element.closest('.rack-channel')?.dataset.channel,step:Number(element.dataset.step),button:event.button,lit:element.classList.contains('on'),membership:rackMembershipBusy,queued:rackStepQueue.length,pending:!!engine.pending,inFlight:!!engine.inFlight});
 rackStepFrozen=null;// a new click always starts from the live rows
 if(!rackStepGesture.start(event)){clientLog('rack-step-dropped',{reason:'gesture-refused',refusal:rackStepEditable()?'scope-or-cells':rackStepRefusal(),step:Number(element.dataset.step)});rackStepElement=null;rackStepPointer=null;engine.interacting=false;return;}
 element.setPointerCapture?.(event.pointerId);element.onpointermove=event=>rackStepGesture.move(event);element.onpointerup=event=>rackStepGesture.finish(event);element.onpointercancel=event=>rackStepGesture.pointerCancel(event);element.onlostpointercapture=event=>rackStepGesture.lostPointerCapture(event);
}
function toggleStepMouseButtons(){activeRackCancel?.();useBothStepButtons=!useBothStepButtons;try{localStorage.setItem('disabelton:step-mouse-mode',useBothStepButtons?'both':'toggle');}catch{}renderRack();toast(useBothStepButtons?'Step sequencer: left enables, right disables.':'Step sequencer: left click toggles steps.');}
function rackGraphContext(){return {projectId:engine.projectId,trackId:engine.session.trackId,load:engine.loadVersion||0,context:engine.session.contextVersion||0,patternId:pattern().id,channelId:channel().id,page:stepPage,filter:$('#channel-filter').value,source:channel().cloudSource??null,mapping:pattern().cloudSources?.[channel().id]??null};}
function rackGraphSteps(){return pattern().steps?.[channel().id]||Array(Math.max(16,Math.ceil(patternLengthBeats(pattern())*4))).fill(false);}
function rackGraphAvailable(){return engine.ready&&(!currentProjectRack()||rackDisplayRows().find(row=>row.id===rackFocusedRow())?.channel?.id===channel().id)&&!!$$('#rack .rack-channel').find(row=>row.dataset.channel===channel().id&&row.querySelector('.step'));}
function syncRackGraph(){
 const button=$('#rack-graph-toggle');button.disabled=!rackGraphAvailable();
 if(!rackGraphAvailable()&&rackGraph.visible)rackGraph.hide();
 if(rackGraph.visible)rackGraph.render({indices:Array.from({length:Math.min(16,Math.max(0,rackGraphSteps().length-stepPage*16))},(_,index)=>stepPage*16+index),label:channel().name});
 button.setAttribute('aria-pressed',String(rackGraph.visible));button.classList.toggle('lit',rackGraph.visible);
}
function toggleRackGraph(){activeRackCancel?.();activePianoCancel?.();activePlaylistCancel?.();if(!rackGraphAvailable())return toast('Select a sample step channel to open its graph.');rackGraph.toggle({indices:Array.from({length:Math.min(16,Math.max(0,rackGraphSteps().length-stepPage*16))},(_,index)=>stepPage*16+index),label:channel().name});syncRackGraph();}
rackGraph=new RackGraphEditor({element:$('#rack-graph'),getContext:rackGraphContext,getSteps:rackGraphSteps,onStatus:toast,
 isEditable:()=>rackGraphAvailable()&&rackBaseEditable()&&!rackStepGesture.active&&(!engine.interacting||rackGraph.active),
 onInteraction:active=>{if(active){engine.interacting=true;activeRackCancel=()=>rackGraph.cancel();}else{activeRackCancel=null;engine.interacting=false;}},
 commit:async({context,before,steps})=>{
  if(JSON.stringify(context)!==JSON.stringify(rackGraphContext())||JSON.stringify(before)!==JSON.stringify(rackGraphSteps()))throw new Error('The graph channel or step data changed.');
  if(engine.interacting||engine.loading||engine.applying||rangeBusy()||sliceBusy()||cloudLibrary?.writeBusy)throw new Error('Finish the current cloud operation before applying step velocity.');
  let applied;try{rackGraphLocalCommit=true;applied=edit(()=>{pattern().steps[context.channelId]=steps;});}finally{rackGraphLocalCommit=false;}if(!applied)return false;
  await engine.flush();if(JSON.stringify(context)!==JSON.stringify(rackGraphContext()))throw new Error('The cloud project changed while the graph was saved.');
  const actual=engine.session.project?.patterns?.find(item=>item.id===context.patternId)?.steps?.[context.channelId];
  if(!Array.isArray(actual)||actual.length!==steps.length||steps.some((value,index)=>(value===true?100/128:value)!==(actual[index]===true?100/128:actual[index])))throw new Error('Freestyle has not confirmed the requested step velocities.');
  return true;
 }});
$('#rack-graph-toggle').onclick=toggleRackGraph;
// FL: the Channel Rack rows never show the browser's own menu (bubble phase:
// each control's own menu handler runs first).
$('#rack-channels').addEventListener('contextmenu',event=>event.preventDefault());
// FL never shows a browser menu (no "Inspect", no Google Lens): every DAW surface's right-click is ours.
// Only text entry keeps the native menu (spelling, paste). Capture phase: a handler that stops
// propagation can no longer leak the native menu; our own menus still open.
const NATIVE_CONTEXT_MENU_TARGETS='input:not([type="range"]):not([type="number"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="color"]):not([type="file"]),textarea,[contenteditable]:not([contenteditable="false"])';
document.addEventListener('contextmenu',event=>{if(!event.target?.closest?.(NATIVE_CONTEXT_MENU_TARGETS))event.preventDefault();},true);
// Logic Step Sequencer: the left header button shows/hides the Pattern Browser drawer (see toggleStepPatternBrowser).
$('#rack-menu').onclick=()=>toggleStepPatternBrowser();
rackSelector=new RackSelectorController({getElement:()=>$('#rack-channels'),getRows:()=>rackDisplayRows().map(row=>row.id),getScope:()=>({project:engine.projectId,track:engine.session.trackId,load:engine.loadVersion||0,context:engine.session.contextVersion||0,pattern:currentProjectRack()?null:pattern().id}),getFocusedRow:rackFocusedRow,isEditable:()=>!$('#rack').classList.contains('hidden'),onMenu:(rowId,event)=>rackRowMenu(event,rowId),onFocus:id=>{selectedRackRow=id;const row=rackDisplayRows().find(row=>row.id===id);if(row?.channel)selectedChannel=row.channel.id;renderRack();renderPiano();}});
function rackClipboardScope(){return {project:engine.projectId,track:engine.session.trackId,load:engine.loadVersion||0,context:engine.session.contextVersion||0,pattern:pattern().id,rows:[...rackSelector.ids]};}
function rackClipboardBinding(rowId){const display=rackDisplayRows().find(row=>row.id===rowId),id=display?.channel?.id;if(!id)throw new Error('Use the selected channel in this pattern before copying or pasting its score.');const sourceId=pattern().cloudSources?.[id];if(typeof sourceId!=='string'||!sourceId)throw new Error('Reload this channel’s current-pattern source binding before using the rack clipboard.');return rackSourceBinding({pattern:pattern(),rowId:id,sourceId});}
rackClipboardWriter=new CloudRackClipboardWriter({engine,getSelection:()=>({pattern:pattern().id,...rackSelector.selection.snapshot(),ids:[...rackSelector.ids],selectedChannel}),restoreSelection:snapshot=>{
 if(!snapshot||snapshot.pattern!==pattern().id)return;rackSelector.selection.clear();for(const id of snapshot.ids)if(rackSelector.selection.rows.includes(id))rackSelector.selection.toggle(id);if(rackSelector.ids.has(snapshot.focusId))rackSelector.selection.focusId=snapshot.focusId;if(rackPatternChannels().some(channel=>channel.id===snapshot.selectedChannel))selectedChannel=snapshot.selectedChannel;rackSelector.sync();
}});
async function rackClipboardAction(action,{queued=false}={}){
 // Pressed while Undo/Redo saves: Cut/Delete clear the rows at once and the
 // operation runs right after, as its own later step (FL never refuses).
 if(!queued&&action!=='copy'&&(rackEditQueueDepth||rackHistorySaving())){
  const beats=patternLengthBeats(pattern()),marks=new Map(['cut','delete'].includes(action)?rackStepChannelIds(null).map(key=>[key,Array(rackRowLength(pattern().steps?.[key],beats)).fill(false)]):[]);
  for(const [key,steps]of marks)rackPendingSteps.set(key,steps);applyRackStepOverlay();const release=()=>{for(const [key,steps]of marks)if(rackPendingSteps.get(key)===steps)rackPendingSteps.delete(key);};
  return queueRackEdit(()=>{release();renderRack();return rackClipboardAction(action,{queued:true});},()=>{release();renderRack();});
 }
 if(rackClipboardBusy||rackGraph?.busy||engine.interacting||engine.applying||engine.loading||rangeBusy()||sliceBusy()||cloudLibrary?.writeBusy)return toast('Finish the current edit before using the Channel Rack clipboard.');
 if(!engine.ready)return toast('Select a Freestyle project first.');
 const scope=rackClipboardScope();rackClipboardBusy=true;
 try{
  await engine.flush();if(JSON.stringify(scope)!==JSON.stringify(rackClipboardScope()))throw new Error('The rack project, pattern or selected channels changed before the clipboard operation.');
  const ids=[...rackSelector.ids];if(!ids.length)throw new Error('Select at least one Channel Rack selector LED.');
  if(action==='copy'){rackClipboard=copyRackScore({projectId:engine.projectId,pattern:pattern(),bindings:ids.map(rackClipboardBinding)});toast(`${countLabel(rackClipboard.entries.length,'channel score')} copied.`);return true;}
  let plan;
  // Delete/Backspace clears the selected channels' score like Cut, keeping the clipboard.
  if(action==='cut'||action==='delete'){plan=cutRackScore({projectId:engine.projectId,pattern:pattern(),bindings:ids.map(rackClipboardBinding),scope});if(action==='cut')rackClipboard=plan.clipboard;}
  else{
   if(!rackClipboard)throw new Error('Copy a Channel Rack score first.');
   const ordered=rackDisplayRows().map(row=>row.id),first=ordered.findIndex(id=>rackSelector.ids.has(id)),targets=ordered.slice(first,first+rackClipboard.entries.length);
   if(first<0||targets.length!==rackClipboard.entries.length)throw new Error('Choose enough existing destination channels below the uppermost selected channel.');
   plan=pasteRackScore({projectId:engine.projectId,pattern:pattern(),clipboard:rackClipboard,mappings:rackClipboard.entries.map((entry,index)=>({entryRowId:entry.binding.rowId,target:rackClipboardBinding(targets[index])})),scope});
  }
  // FL: Cut/Delete/Paste steps is one ordinary Undo step of this pattern.
  let historyStep=null;if(plan.changed){const history=engine.patternHistory;historyStep=history.beginPatternStep({patternId:plan.patternId,label:{cut:'Cut steps',delete:'Delete steps',paste:'Paste steps'}[action]});}
  let result;try{result=await rackClipboardWriter.write(plan);}catch(error){if(historyStep)engine.patternHistory.failExternalStep(historyStep,error);throw error;}
  if(historyStep){if(result?.status==='noop')engine.patternHistory.failExternalStep(historyStep,{message:'The rack clipboard update was not applied.'});else engine.patternHistory.finishPatternStep(historyStep);}
  toast(result.status==='noop'?'The selected channel scores are already empty.':action==='cut'?'Channel scores cut in Freestyle.':action==='delete'?'Channel scores deleted in Freestyle.':'Channel scores pasted in Freestyle.');return result;
 }catch(error){fail(error);return false;}finally{rackClipboardBusy=false;historyEditSettled();}
}

function renderRack(){if(rackStepGesture.active){rackRenderDeferred=true;return;}activeRackCancel?.();for(const widget of rackControlWidgets)widget.destroy();rackControlWidgets.length=0;lastTickKey='';lastTickStep=-1;const rackBeats=patternLengthBeats(pattern()),rackSteps=Math.ceil(rackBeats*4),rackBars=rackBeats/4;stepPage=Math.min(stepPage,Math.max(0,Math.ceil(rackBars)-1));let displayRows=rackDisplayRows();const filter=$('#channel-filter').value;
 // FL lists channels: rows with a source in some pattern. Instrument tracks no pattern uses yet are
 // listed under "Unused instruments" (their "Use in this pattern" stays one click away).
 const laneOnly=row=>!row.channel&&row.model&&Array.isArray(row.model.memberships)&&row.model.memberships.length===0;
 displayRows=filter==='Unused instruments'?displayRows.filter(laneOnly):displayRows.filter(row=>!laneOnly(row));if(filter==='Drums')displayRows=displayRows.filter(row=>(row.channel?.type??row.model?.kind)==='sample');if(filter==='Instruments')displayRows=displayRows.filter(row=>['instrument','plugin'].includes(row.channel?.type??row.model?.kind));
 const focusedRow=rackFocusedRow();$('#rack-channels').innerHTML=displayRows.map(({id:rowId,channel:c,model})=>{const emptyTemplate=!c&&model?.kind==='sample'?rackMissingStepTemplate({id:rowId,model}):null;if(!c)return `<div class="rack-channel rack-missing ${rowId===focusedRow?'selected':''}" data-channel="${esc(rowId)}" data-rack-row="${esc(rowId)}"><button class="channel-enable" disabled aria-label="Channel is unused in this pattern"></button><button class="small-knob pan" disabled></button><button class="small-knob volume" disabled></button><button class="channel-number" disabled title="${esc(rackMixerTarget(null,model)?.name?`Heard on ${rackMixerTarget(null,model).name}`:'No verified mixer output')}">${rackMixerNumber(rackMixerTarget(null,model))}</button><button class="channel-name" title="Use this instrument in the current pattern">${esc(model?.name||'Project instrument')}</button><button type="button" class="channel-selected" data-row-id="${esc(rowId)}" aria-label="Select ${esc(model?.name||'project instrument')}" aria-pressed="false"></button>${model?.kind==='sample'?`<div class="steps">${Array.from({length:16},(_,index)=>{const template=emptyTemplate,step=index+stepPage*16;return `<button class="step" data-step="${step}" ${template.source?'':'disabled'} aria-label="${esc(model.name||'Sample')} step ${step+1}" aria-pressed="false" title="${esc(template.reason||`${model.name||'Sample'} · step ${step+1}`)}"></button>`;}).join('')}</div>`:''}<button class="rack-use-score ${model?.kind==='sample'?'rack-use-settings':'note-preview'}" title="Choose channel settings for this pattern">Use in this pattern</button></div>`;const steps=pattern().steps[c.id]||Array(Math.max(16,rackSteps)).fill(false),notes=pattern().notes[c.id]||[],index=project.channels.indexOf(c);return `<div class="rack-channel ${rowId===focusedRow?'selected':''}" data-channel="${esc(c.id)}" data-rack-row="${esc(rowId)}"><span class="channel-enable ${c.mute?'off':''}" title="Mute ${esc(c.name)}"></span><button class="small-knob pan" style="--rotation:${c.pan*130}deg" title="Pan: ${Math.round(c.pan*100)}%"></button><button class="small-knob volume" style="--rotation:${c.volume*250-125}deg" title="Volume: ${Math.round(c.volume*100)}%"></button><button class="channel-number" title="Open mixer">${index+1}</button><button class="channel-name" title="${esc(c.name)} · click to select and show/hide its plugin window">${esc(c.name)}</button><button type="button" class="channel-selected" data-row-id="${esc(rowId)}" aria-label="Select ${esc(c.name)}" aria-pressed="false" title="Select channel; right-drag selects multiple channels"></button>${notes.some(note=>!isStepPianoNote(note))?`<div class="note-preview" role="button" tabindex="0" title="Open piano roll" aria-label="${esc(c.name)} piano roll preview">${patternPreviewSvg(pattern(),{sourceIds:[c.id],bpm:project.bpm,noteHeight:6})}</div>`:`<div class="steps">${steps.slice(stepPage*16,stepPage*16+16).map((s,i)=>`<button class="step ${s?'on':''}" data-step="${i+stepPage*16}" title="${esc(c.name)} · step ${i+stepPage*16+1}" aria-label="${esc(c.name)} step ${i+stepPage*16+1}" aria-pressed="${!!s}"></button>`).join('')}</div>`}</div>`;}).join('');
 $$('#rack .rack-channel').forEach(row=>{const id=row.dataset.channel,rowId=row.dataset.rackRow||id,c=project.channels.find(c=>c.id===id);if(!c){row.querySelector('.channel-name').onclick=row.querySelector('.rack-use-score').onclick=()=>activateRackRow(rowId);row.querySelector('.channel-name').oncontextmenu=e=>{e.preventDefault();rackRowMenu(e,rowId);};row.querySelectorAll('.step:not(:disabled)').forEach(button=>{button.onpointerdown=event=>beginRackStep(event,button);button.onclick=event=>{if(event.detail!==0||rackStepGesture.active||!rackStepEditable())return;const steps=Array(Math.max(16,Math.ceil(patternLengthBeats(pattern())*4))).fill(false);steps[Number(button.dataset.step)]=true;commitRackSteps({stepsByChannel:new Map([[rowId,steps]])}).catch(fail);};button.oncontextmenu=event=>event.preventDefault();});return;}row.querySelector('.channel-enable').onclick=()=>edit(()=>c.mute=!c.mute);// The mixer track this channel is heard on (FL's insert box): its own instrument lane, its
// declared output lane, a non-Master bus, else the one lane that plays this pattern.
const mixerTarget=rackMixerTarget(c,rackDisplayRows().find(item=>item.channel?.id===c.id)?.model||null),mixerButton=row.querySelector('.channel-number');// FL: the box shows the mixer track number; "-" is the Master (or no verified output).
mixerButton.textContent=rackMixerNumber(mixerTarget);mixerButton.disabled=!mixerTarget;mixerButton.title=mixerTarget?`Open ${mixerTarget.name}`:'No verified mixer output';mixerButton.onclick=()=>{if(!mixerTarget)return;selectedMixerKey=mixerTarget.key;mixerChannel=mixerTarget.id;showWindow('mixer');renderMixer();};row.querySelector('.channel-name').onclick=event=>{selectedChannel=id;selectedRackRow=rowId;rackSelector.selection.focus(rowId);renderRack();renderPiano();if((event?.detail??0)<=1)togglePluginWindow(id);};row.querySelector('.channel-name').ondblclick=()=>{if(!channelPlugin(c))instrumentDialog(id);};row.querySelector('.channel-name').oncontextmenu=e=>{e.preventDefault();channelMenu(e,id);};{const preview=row.querySelector('.note-preview'),openPiano=()=>{selectedChannel=id;showWindow('piano');renderPiano();};preview?.addEventListener('click',openPiano);preview?.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openPiano();}});}
 row.querySelectorAll('.step').forEach(b=>{b.onpointerdown=e=>beginRackStep(e,b);b.onclick=e=>{if(e.detail!==0||rackStepGesture.active||!rackStepEditable())return;const before=pattern().steps[id]||Array(Math.max(16,Math.ceil(patternLengthBeats(pattern())*4))).fill(false),next=useBothStepButtons?true:!before[Number(b.dataset.step)];if(!!before[Number(b.dataset.step)]===next)return;edit(()=>{const steps=before.slice();steps[Number(b.dataset.step)]=next;pattern().steps[id]=steps;});};b.oncontextmenu=e=>stepContextMenu(e,id,Number(b.dataset.step));/* Logic: right-click is a menu, never an erase */});
 bindRackControls(row,c);bindRackSampleDrag(row,c);});
 let pager=$('#rack-step-page');if(!pager){pager=document.createElement('select');pager.id='rack-step-page';pager.title='Step sequencer bar';pager.style.cssText='font-size:9px;padding:2px;height:21px';$('#rack-info').before(pager);}pager.innerHTML=Array.from({length:Math.max(1,Math.ceil(rackBars))},(_,i)=>`<option value="${i}" ${i===stepPage?'selected':''}>Bar ${i+1}</option>`).join('');pager.onchange=()=>{stepPage=+pager.value;renderRack();};
 $('#rack-info').textContent=`${rackSteps} STEPS　/　${rackBars} BAR${rackBars!==1?'S':''}`;{const stepsBox=$('#rack-steps');if(stepsBox){stepsBox.textContent=String(rackSteps);stepsBox.title=`Pattern length: ${rackSteps} steps (${rackBars} bar${rackBars!==1?'s':''})`;}}rackSelector?.sync();syncRackGraph();applyRackStepOverlay();paintRackChannelDecor();decorateStepSequencerRows();syncStepSequencerHeader();
}
// Saved-first REST mixer controls stay clickable while an earlier mixer write
// persists: MixerControlQueue serializes them and retries a busy controller.
function mixerControlEditable(){return restMixer?.isRestMode?!workspaceBusy({ignoreRestMixer:true})&&engine.ready&&!engine.loading&&!rackClipboardBusy&&!rackGraph?.busy&&!rangeBusy()&&!sliceBusy()&&!cloudLibrary?.writeBusy:directLevelEditable();}
function directLevelEditable(){return !workspaceBusy()&&engine.ready&&!engine.loading&&!engine.applying&&!rackClipboardBusy&&!rackGraph?.busy&&!rangeBusy()&&!sliceBusy()&&!cloudLibrary?.writeBusy;}
function rackControlEditable(widget){return rackBaseEditable()&&!rackGraph?.busy&&!rackStepGesture.active&&!mixerView?.active&&(!activeRackKnob||activeRackKnob===widget)&&(!engine.interacting||activeRackKnob===widget);}
function rackControlInteraction(widget,active){if(active){activeRackKnob=widget;widget.rackCancel=Object.assign(()=>widget.cancel(),{pointerId:widget.gesture?.pointerId});activeRackCancel=widget.rackCancel;engine.interacting=true;}else if(activeRackKnob===widget){activeRackKnob=null;if(activeRackCancel===widget.rackCancel)activeRackCancel=null;engine.interacting=false;if(mixerRenderPending){mixerRenderPending=false;queueMicrotask(()=>renderMixer());}}}
function bindRackControls(row,c){
 const owner=project,patternId=pattern().id,scope=()=>{if(project!==owner||pattern().id!==patternId||project.channels.filter(channel=>channel.id===c.id).length!==1||!project.channels.includes(c))throw new Error('The Channel Rack changed. Use its current control.');return{...mixerScope(),patternId,channelId:c.id,sourceId:c.sourceId??null,laneId:c.laneId??null};};
 let volume;volume=attachChannelLevelKnob(row.querySelector('.volume'),{getValue:()=>c.volume,getScope:scope,isEditable:()=>rackControlEditable(volume),label:c.name+' volume',min:0,max:Math.max(1.5,c.volume),reset:1,onInteraction:active=>rackControlInteraction(volume,active),onStatus:message=>{$('#hint').textContent=message;},onCommit:async packet=>{if(JSON.stringify(packet.scope)!==JSON.stringify(scope())||!mixValuesEqual(c.volume,packet.before))throw new Error('The channel level changed before this gesture finished.');if(!edit(()=>{c.volume=packet.value;}))throw new Error('Finish the current edit before changing this channel level.');await engine.flush();}});rackControlWidgets.push(volume);
 row.querySelector('.volume').oncontextmenu=event=>{event.preventDefault();const locked=volume.button.disabled;menu(event,[['Reset','Alt+click',()=>volume.resetToDefault(),locked],['Type in value…','',()=>textDialog(c.name+' volume','Volume (%)',String(c.volume*100),value=>volume.setValue(Number(value)/100)),locked],...valueClipboardItems('gain',()=>c.volume,value=>volume.setValue(value),locked),null,automationMenuItem(laneGainAutomation(c.laneId,c.name),c.laneId?AUTOMATION_UNSUPPORTED:'This channel has no Freestyle lane, so it has no track volume automation target.')]);};
 const button=row.querySelector('.pan'),target=restMixer?.isRestMode&&c.laneId?currentMixerModel().rows.find(item=>item.kind==='lane'&&item.id===c.laneId):null;
 if(!target?.controls.pan.enabled){button.disabled=true;button.title=c.laneId?'Read this track’s saved pan in the Mixer.':'Per-source pan is awaiting a Freestyle API update.';return;}
 let pan;pan=attachMixerPanKnob(button,target,{getCurrentRow:key=>currentMixerModel().rows.find(item=>item.key===key),getScope:scope,isEditable:()=>rackControlEditable(pan),onInteraction:active=>rackControlInteraction(pan,active),onStatus:toast,onPan:packet=>{scope();return mixerControl({...packet,scope:mixerScope()},'pan');},onPanLive:packet=>liveMixerControl({...packet,scope:mixerScope()},'pan')});button.classList.remove('mixer-pan');rackControlWidgets.push(pan);
 const changePan=value=>{try{scope();const current=currentMixerModel().rows.find(item=>item.key===target.key);if(!Number.isFinite(value)||value< -1||value>1)throw new Error('Enter pan from −100% to 100%.');if(!rackControlEditable(pan)||!current?.controls.pan.enabled)throw new Error('Wait for the current cloud edit before changing pan.');if(current.values.pan.value===value)return;const operation=mixerControl({row:current,before:current.values.pan.value,value,scope:mixerScope()},'pan');button.disabled=true;Promise.resolve(operation).catch(fail).finally(()=>pan.sync());}catch(error){fail(error);}};
 button.addEventListener('pointerdown',event=>{if(event.button===1||event.button===0&&event.altKey){event.preventDefault();event.stopImmediatePropagation();if(!button.disabled)changePan(0);}},true);
 button.oncontextmenu=event=>{event.preventDefault();if(button.disabled)return;const before=currentMixerModel().rows.find(item=>item.key===target.key)?.values.pan.value;menu(event,[['Reset','Alt+click',()=>changePan(0)],['Type in value…','',()=>textDialog(c.name+' pan','Pan (%) · left −100, center 0, right 100',String(before*100),value=>changePan(Number(value)/100))],...valueClipboardItems('pan',()=>currentMixerModel().rows.find(item=>item.key===target.key)?.values.pan.value,value=>changePan(value)),null,automationMenuItem(lanePanAutomation(target.id,c.name,before))]);};
}

/** Zoom-adaptive bar ruler (ruler-scale.js): re-rendered only when the bar count or the density changes.
 * `host` receives the matching grid line spacing as --grid-major / --grid-mid / --grid-minor. */
function renderBarRuler(ruler,bars,pxPerBar,{attribute='data-beat',subLabels=true,host=null}={}){
 const scale=rulerScale(pxPerBar),key=`${bars}:${scale.key}:${attribute}`;
 if(host){const grid=rulerGridWidths(pxPerBar,scale);for(const [name,value]of Object.entries(grid))host.style.setProperty(`--grid-${name}`,value);}
 ruler.classList.toggle('ruler-fine',scale.fineDivisions>0);
 if(ruler.dataset.rulerScale===key&&ruler.querySelector('.ruler-bar'))return false;
 // Keep non-bar children (the loop brace, the Clip View's marker layer) across a re-render.
 const kept=[...ruler.children].filter(child=>!child.classList.contains('ruler-bar'));
 ruler.innerHTML=Array.from({length:bars},(_,index)=>rulerBarMarkup(index,scale,{attribute,subLabels})).join('');ruler.append(...kept);ruler.dataset.rulerScale=key;return true;
}
let pianoRulerBars=16;
/** Clip View / Piano Roll ruler and grid at the editor's own zoom (called on render and on every zoom). */
function renderPianoRuler(bars=pianoRulerBars){pianoRulerBars=bars;const ruler=$('#piano-ruler');if(!ruler)return;
 // The key column's own top cell: opaque and above the ruler, so a scrolled ruler is clipped at the keys (ruler-scale.css).
 if(!document.getElementById('piano-ruler-corner')){const corner=document.createElement('div');corner.className='piano-ruler-corner';corner.id='piano-ruler-corner';corner.setAttribute('aria-hidden','true');ruler.before(corner);}
 renderBarRuler(ruler,bars,pianoBarWidth,{attribute:'data-piano-beat',subLabels:false,host:$('#piano')});}
function renderTimelineGeometry(clock=engine.session.positionAt?.()||engine.positionAt?.()||{}){
 const loopEnd=clock.loopEnabled?(Number(clock.loopEndSec)||0)*(clock.bpm||project.bpm)/60:0,length=Math.max(64,loopEnd,...allClips().map(c=>c.start+c.length)),bars=Math.max(16,Math.ceil(length/4)+4,Math.ceil(Math.max(0,$('#arrangement-scroll').clientWidth-PLAYLIST_GUTTER)/barWidth)+4);
 /* Owner bug 1: the Arrangement zooms to sample level (about one source frame per pixel); the cap keeps the scroll extent inside the browser's layout limit. */
 try{if(ablWaveforms)timelineViewport.max=Math.max(896,Math.min(131072,Math.floor(16e6/bars)));}catch{}
 $('#arrangement').style.width=`calc(${PLAYLIST_GUTTER}px + ${bars} * var(--bar))`;
 // Ruler: bar numbers every 1, 2, 4, 8 ... bars by zoom, beat then division ticks when zoomed in (ruler-scale.js). The
 // sub-bar LABELS (bars.beats.sixteenths) stay the shell's virtualized beat ruler (abl-shell.js paintTimeRuler), which
 // works to sample-level zoom; the header column's top cell is the shell's #abl-arr-corner (ruler-scale.css).
 const ruler=$('#timeline-ruler');renderBarRuler(ruler,bars,barWidth,{subLabels:false,host:$('#playlist')});
 const start=(clock.loopStartSec||0)*(clock.bpm||project.bpm)/60;[...ruler.children].filter(child=>child.classList.contains('ruler-bar')).forEach((bar,i)=>bar.classList.toggle('in-loop',!!clock.loopEnabled&&i*4<loopEnd&&(i+1)*4>start));playlistLoop?.render(clock);playlistNavigator?.refresh();queueCloudWaveforms();
}
let libraryPlaylistDropHint=false;
function unsupportedPlaylistSampleDrop(event){
 // Studio API projects place Browser/Rack samples as audio clips (handled by the
 // #arrangement-scroll receiver); only other connections still refuse.
 if(![...(event.dataTransfer?.types||[])].includes('application/vegetable-library-sound')||playlistSamplePlacementSupported())return false;
 event.dataTransfer.dropEffect='none';if(!libraryPlaylistDropHint){libraryPlaylistDropHint=true;toast('Drop samples into the Channel Rack. Playlist sample placement needs a Freestyle Studio API project.');}return true;
}
document.addEventListener('dragend',()=>{libraryPlaylistDropHint=false;});
function renderPlaylist(){activePlaylistCancel?.();playlistSelection.sync(project);clipWaveforms.sync(project.audioClips||[]);if(ablWaveforms){ablWaveforms.sync(project.audioClips||[]);/* Round 3: no read-ahead of every clip at load — it competed with the monitor offer and the playback-state read (first-click latency). Visible clips read on paint; the rest when scrolled to. */}if(!playlistSelection.has(selectedClip))selectedClip=playlistSelection.ids.values().next().value||null;renderTimelineGeometry();
 const laneCount=Math.max(12,project.cloud?.timelineLaneIds?.length||0,...allClips().map(c=>Number(c.track)+1));$('#track-lanes').innerHTML=Array.from({length:laneCount},(_,track)=>`<div class="track-lane">${logicTrackHeaderHtml({track,name:project.trackNames?.[track]||`Track ${track+1}`,kind:logicTrackKind(track),empty:track>=logicRealTrackCount(),ledOff:playlistTrackLedOff(track)})}<div class="lane-grid" data-track="${track}">${project.clips.filter(c=>c.track===track).map(c=>{const p=project.patterns.find(p=>p.id===c.patternId);if(!p)return '';const color=colors[project.patterns.indexOf(p)%colors.length];return `<div class="clip ${playlistSelection.has(c.id)?'selected':''} ${c.cloudRaw?.muted?'muted-item':''} ${c.pendingLane?'pending-lane':''}" data-clip="${esc(c.id)}" style="left:calc(${c.start/4} * var(--bar));width:calc(${c.length/4} * var(--bar));background:${color};border-color:${color}"><div class="clip-title"><button class="clip-menu-trigger" title="Clip menu" aria-label="Clip menu">▸</button> ${esc(c.name??p.name)}</div>${patternSvg(p,'#2d4844',c)}<div class="clip-resize" title="Trim right edge"></div><div class="clip-trim-start" title="Trim left edge" aria-label="Trim clip start"></div></div>`;}).join('')}${(project.audioClips||[]).filter(c=>c.track===track).map(c=>{const clipMuted=audioClipMuteValue(c.id);return `<div class="clip audio-clip ${playlistSelection.has(c.id)?'selected':''} ${clipMuted===true?'muted-item':''} ${c.cloudRaw?.muted===true?'lane-muted':''}" data-clip="${esc(c.id)}" data-audio="true" data-clip-muted="${clipMuted===null?'unknown':String(clipMuted)}" title="${esc(audioClipMuteTooltip({muted:clipMuted===true}))}" style="left:calc(${c.start/4} * var(--bar));width:calc(${c.length/4} * var(--bar))"><div class="clip-title"><button class="clip-menu-trigger" title="Audio clip menu" aria-label="Audio clip menu">≋</button> ${esc(c.name||'Audio')}</div>${audioWave(c)}<div class="clip-resize" title="Trim right edge"></div><div class="clip-trim-start" title="Trim left edge" aria-label="Trim clip start"></div></div>`;}).join('')}</div></div>`).join('');
 $$('#playlist .lane-grid').forEach(lane=>{/* Logic: right-click / Control-click opens the Tracks menu; it never erases. */lane.oncontextmenu=e=>{if(e.target!==lane)return;e.preventDefault();if(tool!=='zoom')logicShellHooks.tracksMenu?.(e);};lane.onpointerdown=e=>{if(e.isPrimary===false||e.target!==lane)return;if(playlistZoomRequest(e))return playlistZoom(e,lane);if(logicShellHooks.isContextClick?.(e))return;if(tool==='playback'){if(e.button===0)return playlistPlayback(e,lane);if(e.button===2){e.preventDefault();e.stopPropagation();return;}}if(e.button!==0)return;if(e.ctrlKey||e.metaKey||tool==='select')return marqueePlaylist(e,lane);if(tool==='paint'||tool==='draw'&&e.shiftKey)return paintLane(e,lane);if(tool==='draw')return playlistDraw(e,lane);};
 lane.ondragover=e=>{if(!unsupportedPlaylistSampleDrop(e))e.preventDefault();};lane.ondrop=e=>{e.preventDefault();if(unsupportedPlaylistSampleDrop(e)){e.stopPropagation();return;}const pid=e.dataTransfer.getData('application/vegetable-pattern'),p=project.patterns.find(p=>p.id===pid);if(!p)return;const start=playlistDropBeat({clientX:e.clientX,left:playlistGridOrigin(lane),barWidth,snap:e.altKey?0:+$('#snap').value});clientLog('playlist-drop',{...playlistDropRecord({source:'pattern',clientX:e.clientX,left:playlistGridOrigin(lane),barWidth,snap:e.altKey?0:+$('#snap').value,track:+lane.dataset.track,laneId:project.cloud?.timelineLaneIds?.[+lane.dataset.track]||null}),patternId:pid,bpm:project.bpm,geometry:playlistDropGeometry(lane)});edit(()=>project.clips.push({id:uid(),patternId:pid,track:+lane.dataset.track,start,length:patternLengthBeats(p)}));};});
 $$('#playlist .clip[data-clip]').forEach(el=>{el.style.touchAction='none';el.onpointerdown=e=>clipDrag(e,el);el.ondragstart=e=>{e.preventDefault();clipGestureRecord('nativeDragBlocked',{reason:'browser-default',prevented:e.defaultPrevented});};el.ondblclick=()=>{const c=findClip(el.dataset.clip);if(!c)return;if(c.patternId){selectPattern(c.patternId);/* Logic: a Pattern region opens the Step Sequencer, a MIDI region the Piano Roll */openEditorPane(editorForPattern(pattern()));}else audioProperties(c);};el.oncontextmenu=e=>{e.preventDefault();e.stopPropagation();/* Logic: right-click / Control-click opens the region menu (Ctrl+Option drag is the zoom gesture). */if(tool==='zoom')return;if(logicShellHooks.regionMenu)logicShellHooks.regionMenu(e,findClip(el.dataset.clip));else playlistClipMenu(e,findClip(el.dataset.clip));};const trigger=el.querySelector('.clip-menu-trigger');trigger.onpointerdown=e=>e.stopPropagation();trigger.onclick=e=>{e.stopPropagation();playlistClipMenu(e,findClip(el.dataset.clip));};});
 $$('#playlist .track-label').forEach(el=>{el.ondblclick=()=>textDialog('Rename Track','Track name',project.trackNames?.[+el.dataset.track]||`Track ${+el.dataset.track+1}`,name=>edit(()=>{project.trackNames||={};project.trackNames[+el.dataset.track]=name;}));el.querySelector('.track-enable').onclick=event=>{const t=+el.dataset.track;
  // Round 24: a track with a saved lane mutes through the same undoable path as the track menu's Mute.
  if(playlistTrackLaneMute(t)!==null){event?.stopPropagation?.();if(!playlistTrackEditable())return toast('Finish the current cloud edit before muting this track.');Promise.resolve().then(()=>togglePlaylistTrackMute(t)).then(syncPlaylistTrackLeds,fail);return;}
  edit(()=>{project.mutedTracks||=[];project.mutedTracks=project.mutedTracks.includes(t)?project.mutedTracks.filter(v=>v!==t):[...project.mutedTracks,t];});};});
 paintAutomationClips();
 paintPendingSplits();
 queueCloudWaveforms();
 logicShellHooks.afterTracks?.();
}
/* QA r7: ⌘E showed nothing until the slice saved (~1.3 s). The two halves are painted at once (a cut and the right
   half's title over the clip, re-applied after interim renders); the paint is dropped when the save settles, so a
   confirmed slice shows the canonical halves and a refused one shows the unsplit clip again. The slice stays one
   history step: this is paint only, never a model edit. */
const pendingSplitPaints=new Map();
function paintPendingSplits(){for(const [id,{beat,name}]of pendingSplitPaints){const clip=findClip(id),el=[...document.querySelectorAll('#playlist .clip[data-clip]')].find(node=>node.dataset.clip===id);if(!clip||!el||el.querySelector('.abl-split-pending-cut')||!(beat>clip.start&&beat<clip.start+clip.length))continue;const cut=document.createElement('div');cut.className='abl-split-pending-cut';cut.setAttribute('aria-hidden','true');cut.style.left=`calc(${(beat-clip.start)/4} * var(--bar))`;cut.innerHTML=`<span class="abl-split-pending-title">${esc(name)}</span>`;el.classList.add('abl-split-pending');el.append(cut);}}
function clearPendingSplit(id){pendingSplitPaints.delete(id);for(const el of document.querySelectorAll('#playlist .clip.abl-split-pending'))if(el.dataset.clip===id){el.classList.remove('abl-split-pending');el.querySelectorAll('.abl-split-pending-cut').forEach(node=>node.remove());}}
function splitClipOptimistic(clip,beat){
 const run=clip?.patternId?slicePatternPlacement:sliceAudioClip;if(!clip?.id||!(beat>clip.start&&beat<clip.start+clip.length)||!playlistEditable())return run(clip,beat);
 pendingSplitPaints.set(clip.id,{beat,name:clip.name||project.patterns.find(item=>item.id===clip.patternId)?.name||'Audio'});paintPendingSplits();
 let result;try{result=run(clip,beat);}catch(error){clearPendingSplit(clip.id);throw error;}return Promise.resolve(result).finally(()=>clearPendingSplit(clip.id));
}

function waveformViewportOptions(clip){
 const viewport=$('#arrangement-scroll'),visibleWidth=Math.max(0,viewport.clientWidth-PLAYLIST_GUTTER),pixelsPerBeat=barWidth/4,left=visibleWidth?viewport.scrollLeft/pixelsPerBeat:clip.start,right=visibleWidth?(viewport.scrollLeft+visibleWidth)/pixelsPerBeat:clip.start+clip.length,start=Math.max(clip.start,left),end=Math.min(clip.start+clip.length,right);
 if(end<=start)return null;const secondsPerBeat=60/project.bpm;
 return{buckets:Math.max(1,Math.min(64,Math.ceil((end-start)*pixelsPerBeat*2))),clipStartSec:(start-clip.start)*secondsPerBeat,clipEndSec:(end-clip.start)*secondsPerBeat};
}
function playlistClipMenu(event,clip){
 if(!clip)return;const current=project,version=engine.loadVersion;
 const guarded=action=>()=>{if(project!==current||engine.loadVersion!==version||findClip(clip.id)!==clip)return toast('The cloud clip changed; reopen its menu.');return action();};
 if(!clip.patternId)menu(event,[['Audio clip properties','',guarded(()=>audioProperties(clip))],['Add to Channel Rack','',guarded(()=>addAudioClipToRack(clip).catch(fail))],['Edit source samples…','',guarded(()=>openSampleEditor(clip).catch(fail))],['Render region effect…','',guarded(()=>regionEffects.open({clipId:clip.cloudId}))],['Reload waveform','',guarded(()=>{clipWaveforms.invalidate(clip.cloudId);queueCloudWaveforms();})],['Automation envelope…','',guarded(()=>openAutomation(clip))],['Delete audio clip','Del',guarded(()=>edit(()=>project.audioClips=project.audioClips.filter(item=>item.id!==clip.id)))]]);
 else menu(event,[['Delete clip','Del',guarded(()=>edit(()=>project.clips=project.clips.filter(item=>item.id!==clip.id)))],['Automation envelope…','',guarded(()=>openAutomation(clip))],['Make unique','',guarded(()=>makeUnique(clip.id))],['Duplicate','',guarded(()=>edit(()=>{project.clips.push({...clone(clip),id:uid(),start:clip.start+clip.length});}))]]);
}
function waveformContent(clip,options){if(ablWaveforms)return '';let state=options?clipWaveforms.peek(clip,options):{status:'idle'};/* Disabelton: a moved region keeps its identical drawing until its own read lands */if(options&&['idle','loading'].includes(state.status))state=clipWaveforms.peekMoved?.(clip,options)||state;return state.status==='ready'?clipWaveformSvg(state.waveform,{width:Math.max(1,clip.length*barWidth/4)}):`<div class="audio-clip-label" title="${esc(state.error||'Waveform loads from Freestyle when this clip is visible.')}">${state.status==='loading'?'LOADING WAVEFORM':state.status==='error'?'WAVEFORM UNAVAILABLE':'CLOUD AUDIO'}</div>`;}
function audioWave(clip){return`<span class="audio-waveform" style="display:contents">${waveformContent(clip,waveformViewportOptions(clip))}</span>`;}
function queueCloudWaveforms(delay=0){
 if(delay){clearTimeout(waveformTimer);waveformTimer=setTimeout(()=>{waveformTimer=null;queueCloudWaveforms();},delay);return;}
 if(waveformQueued||clipWaveforms.destroyed)return;waveformQueued=true;Promise.resolve().then(()=>{waveformQueued=false;refreshCloudWaveforms();});
}
function refreshCloudWaveforms(){
 if(ablWaveforms){if(engine.ready&&project.cloud?.projectId===engine.projectId)ablWaveforms.now();return;}
 if(clipWaveforms.destroyed||!engine.ready||project.cloud?.projectId!==engine.projectId)return;
 /* QA r7: a read that lands while an edit/undo holds the workspace was dropped until the next full re-render
    (keyboard ⌘Z sends no pointerup). Re-arm a short retry so the waveform paints as soon as the hold ends. */
 /* QA r8: an Undo/Redo's preview shows the restored geometry before its write lands; a read then returns the old saved window. Read once the step resolves. */
 if(engine.loading||engine.applying||engine.interacting||engine.historyPending||engine.patternHistory?.busy||engine.patternHistory?.optimisticPending||activePlaylistCancel||windows.dragging){waveformPaintPending=true;queueCloudWaveforms(120);return;}waveformPaintPending=false;
 const viewport=$('#arrangement-scroll'),rowHeight=$('.track-lane')?.getBoundingClientRect().height||playlistLaneHeight;
 for(const element of $$('#playlist .audio-clip[data-clip]')){
  const clip=findClip(element.dataset.clip);if(!clip?.cloudId)continue;
  if(viewport.clientHeight&&playlistLayout.rowTop(clip.track+1,rowHeight)<viewport.scrollTop||viewport.clientHeight&&playlistLayout.rowTop(clip.track,rowHeight)>viewport.scrollTop+viewport.clientHeight)continue;
  const options=waveformViewportOptions(clip);if(!options)continue;
  const target=element.querySelector('.audio-waveform'),state=clipWaveforms.peek(clip,options);
  if(state.status==='idle'){clipWaveforms.load(clip,options).catch(()=>{});}
  if(target){const markup=waveformContent(clip,options);if(target.innerHTML!==markup)target.innerHTML=markup;target.dataset.waveformStatus=clipWaveforms.peek(clip,options).status;}
 }
}
function audioProperties(c){const d=dialog(c.name||'Audio clip',`<p>${c.engineLoaded===false?'Stored in Freestyle. The live engine has not loaded this clip yet; its native import-to-live session sync needs to run.':'Audio stored and played in Freestyle.'}</p><label>Start (beats)</label><input id="audio-start" type="number" min="0" step=".25" value="${c.start}"><label>Length (beats)</label><input id="audio-length" type="number" min=".25" step=".25" value="${c.length}"><label>Source offset (beats)</label><input id="audio-offset" type="number" min="0" step=".25" value="${c.offset||0}" ${c.offsetKnown===false?'disabled title="Freestyle has not exposed the source offset"':''}><button id="audio-apply" class="primary">Apply to cloud clip</button><button id="audio-automation">Automation…</button>`);d.querySelector('#audio-apply').onclick=()=>{const start=+d.querySelector('#audio-start').value,length=+d.querySelector('#audio-length').value,offset=+d.querySelector('#audio-offset').value;if(start<0||length<=0||offset<0)return;edit(()=>{c.start=start;c.length=length;c.offset=offset;});d.close();};d.querySelector('#audio-automation').onclick=()=>{d.close();openAutomation(c);};}
async function openAutomation(clip=findClip(selectedClip)||project.clips[0]||(project.audioClips||[])[0],envelope=null){if(!engine.ready)return openCloudPanel();if(!clip&&!envelope)return toast('Place a cloud clip before creating automation.');const {openAutomationEditor}=await import('./automation-ui.js');automationStore.bind(project.cloud?.projectId||project.id);
 // Saves reconcile from each envelope response; no full project refresh per point.
 return openAutomationEditor({project,store:automationStore,remove:envelope=>automationHosts.remove({envelope}),envelopeKey:envelope?`${envelope.clipId}|${envelope.targetKey}`:undefined,clipId:envelope?envelope.clipId:clip.patternId?'pattern:'+(clip.cloudId||clip.id):(clip.cloudId||clip.id),cloudCall:engine.session.call.bind(engine.session)});}
// Re-read envelopes only when the project or its set of host clip identities changes (load, split, restore),
// never for unrelated edits; saves reconcile from their own responses.
function automationScopeKey(){if(!engine.ready||!project)return '';const ids=[...(project.clips||[]).map(clip=>'p:'+(clip.cloudId||'')),...(project.audioClips||[]).map(clip=>'a:'+(clip.cloudId||''))].filter(id=>id.length>2).sort();return `${project.cloud?.projectId||project.id}|${ids.join(',')}`;}
/**
 * Studio Pro warms the engine session right after a project opens (nonblocking,
 * deduplicated). Our Studio API equivalent is the lane plugin inventory read:
 * warm it in the background once per load so the first plugin window / mixer
 * tools open reuses the live result or its in-flight read.
 */
function schedulePluginInventoryPrewarm(){
 if(!engine.ready||engine.loading||!project?.cloud?.rawState?.studioApi)return;
 const projectId=project.cloud.projectId||project.id,trackId=project.cloud.trackId,loadVersion=engine.loadVersion||0,key=`${projectId}|${trackId}|${loadVersion}`;
 if(key===pluginInventoryScope)return;pluginInventoryScope=key;pluginInventory.invalidate();
 const scopes=prewarmLaneScopes(project.cloud.rawProject,{projectId,trackId,loadVersion});if(!scopes.length)return;
 const isCurrent=()=>pluginInventoryScope===key&&engine.ready&&!engine.loading&&engine.projectId===projectId&&(engine.loadVersion||0)===loadVersion;
 // After the first render and the audio peer's signaling have started; one read at a time.
 setTimeout(()=>pluginInventory.prewarm(scopes,scope=>{const controller=new MixerToolsController({...scopedMixerOptions({id:scope.laneId,laneId:scope.laneId}),inventory:null});return controller.call('list_plugins',{...controller.context(),lane_id:scope.laneId});},{isCurrent,onResult:({scope,ok,ms,error})=>{try{(window.__vegetablePluginPrewarm||=[]).push({laneId:scope.laneId,ok,ms,error:error?.message||''});}catch{}}}).catch(()=>{}),250);
}
/** Diagnostics: what the store holds and why an envelope is not drawn (logged when it changes). */
let automationRenderSignature='',automationPlacementSignature='';
function logAutomationRender(){try{const all=automationStore.list(),persisted=automationStore.persisted(),missing=persisted.filter(envelope=>!automationHostClip(project,envelope.clipId));const unsaved=all.filter(envelope=>!(envelope.persisted&&envelope.id));const data={loaded:automationStore.loaded,error:automationStore.error||null,listed:all.length,persisted:persisted.length,drawn:persisted.length-missing.length,filtered:[...missing.map(envelope=>({clipId:envelope.clipId,id:envelope.id,reason:'host clip not in the current project'})),...unsaved.filter(envelope=>envelope.saving||envelope.saveError).map(envelope=>({clipId:envelope.clipId,reason:envelope.saveError?'save failed: '+envelope.saveError:'saving'}))].slice(0,20),defaults:unsaved.filter(envelope=>!envelope.saving&&!envelope.saveError).length};const signature=JSON.stringify(data);if(signature!==automationRenderSignature){automationRenderSignature=signature;clientLog('automation-render',data);}}catch{}}
/**
 * Plugin parameter Undo/Redo as a generic external history step. Each side
 * re-reads the parameter page fresh and refuses (dispatched:false) unless the
 * saved value still equals the side it expects; then one guarded write.
 */
/** Resolves once no history step or other cloud edit runs (bounded ~5 s): an open plugin window's reads are refused until then. */
async function pluginDialogIdle(){for(let wait=0;wait<200&&(workspaceBusy()||engine.patternHistory?.reserved?.length);wait++)await new Promise(resolve=>setTimeout(resolve,25));}
/** FL: one plugin GUI gesture (drag / scroll burst) = ONE Undo step over every parameter it moved. */
function recordPluginGestureHistory({c,plugin,changes,scope,dialog}){
 if(!engine.patternHistory?.recordExternalStep||!changes?.length)return false;
 // A fresh, history-scoped controller: its parameter page is read now; each write is instance-pinned and compare-and-set.
 const open=async()=>{const controller=new MixerToolsController(scopedMixerOptions(c,{historyStep:true}));if(!controller.adoptSavedSlot({...plugin,savedChain:true}))await controller.ensurePlugin(plugin,{cached:true});await controller.readPlugin(plugin.index);return{controller,plugin};};
 // Round 39 speed: normalized-only gestures undo/redo with ONE guarded write per change
 // (instance-pinned, compare-and-set on expected_value_norm), confirmed by its reply; the
 // knob, list and GUI frame repaint at once and the page re-read runs in the background.
 const fast=fastGestureEligible(changes)&&!!expectedPluginFields(plugin).expected_plugin_instance_id&&!!c?.laneId;
 const guardedWrite=()=>{const controller=new MixerToolsController(scopedMixerOptions(c,{historyStep:true}));return change=>(value,expected)=>controller.call('set_plugin_parameter',{...controller.context(),lane_id:c.laneId,plugin_index:plugin.index,parameter_index:change.index,value_norm:value,expected_value_norm:expected,...expectedPluginFields(plugin)});};
 const dialogValue=index=>dialog.isOpen()?dialog.controller?.parameters?.find(row=>row.index===index)?.normalized:undefined;
 const apply=async direction=>{const started=performance.now();let result;
  if(fast){const writer=guardedWrite();result=await applyGestureChangesGuarded({write:(change,value,expected)=>writer(change)(value,expected),changes,direction,current:dialogValue,log:clientLog});
   // Show the confirmed values now (the background re-read below reconciles).
   if(dialog.isOpen())for(const change of result.changes){const row=dialog.controller?.parameters?.find(item=>item.index===change.index);if(row)row.normalized=change.value;}}
  else result=await applyGestureChanges({open,changes,direction,log:clientLog});
  const settle=()=>{const preview=dialog.controller?.historyPreviewValues;for(const change of result.changes)if(preview?.get(change.index)===change.value)preview.delete(change.index);dialog.repaint();dialog.refreshGui?.();};
  if(fast)settle();
  // Coalesced re-read: rapid ⌘Z/⌘⇧Z end on the latest step's values.
 if(dialog.isOpen())dialog.controller.refreshParameters({whenIdle:pluginDialogIdle}).then(settle,settle);else settle();clientLog('plugin-gesture-history-apply',{direction,changes:changes.length,fast,ms:Math.round(performance.now()-started)});return{laneId:c?.laneId??null,pluginIndex:plugin.index,...result};};
 const previewUi=direction=>{const controller=dialog.controller;if(!controller||!dialog.isOpen())return null;const preview=controller.historyPreviewValues||=new Map(),values=changes.map(change=>[change.index,direction==='undo'?change.before:change.after]);for(const [index,value]of values)preview.set(index,value);dialog.repaint();return()=>{for(const [index,value]of values)if(preview.get(index)===value)preview.delete(index);if(dialog.isOpen())dialog.repaint();};};
 return engine.patternHistory.recordExternalStep({kind:'plugin_parameter',label:gestureStepLabel(plugin.name,changes),scope,detail:{laneId:c?.laneId??null,pluginIndex:plugin.index,gesture:true,changes},undo:()=>apply('undo'),redo:()=>apply('redo'),previewUi});
}
function recordPluginParameterHistory({c,plugin,index,paramId,name,form,before,after,scope,dialog}){
 if(!engine.patternHistory?.recordExternalStep)return false;
 const near=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=Math.max(1e-6,Math.abs(b)*1e-6);
 const apply=async(from,to)=>{
  const open=dialog.isOpen(),refused=message=>{clientLog('plugin-param-history-refused',{index,from,to,message});return Object.assign(new Error(message),{dispatched:false});};let controller;
  // A fresh, history-scoped reader/writer: reads the parameter's page now and writes once.
  try{controller=new MixerToolsController(scopedMixerOptions(c,{historyStep:true}));if(!controller.adoptSavedSlot({...plugin,savedChain:true}))await controller.ensurePlugin(plugin,{cached:true});await controller.readPlugin(plugin.index);for(let page=0;page<20&&!controller.parameters.some(row=>row.index===index)&&controller.parameterPagination.hasMore;page++)await controller.loadMoreParameters();}
  catch(error){throw Object.assign(error,{dispatched:false});}
  const row=controller.parameters.find(item=>item.index===index);if(!row||row.id!==paramId)throw refused(`Reload ${plugin.name||'the plugin'} before undoing ${name}: the parameter is no longer on its page.`);
  const control=controller.parameterControl(row);if(!control||control.form!==form)throw refused(`${name} changed its write form; reload the plugin.`);
  // Already at this step's target (e.g. the write landed but its reply was slow, or someone set the same value): a quiet no-op that advances history.
  // Every applied step (no-op included) updates the values other views paint from (Device View sessions, plug-in window).
  const announce=()=>{if(controller.target?.kind==='lane')try{window.dispatchEvent(new CustomEvent('abl:plugin-values',{detail:{laneId:controller.target.id,instanceId:plugin.instance_id??plugin.instanceId??plugin.id,parameters:[{index,...(form==='normalized'?{normalized:to}:{value:to})}],source:'history'}}));}catch{}};
  // The no-op still re-reads the recording view's confirmed page (its control still holds the pre-step value).
  if(near(control.value,to)){clientLog('plugin-param-history',{index,from,to,open,noop:true});const settleNoop=()=>{const preview=dialog.controller?.historyPreviewValues;if(preview?.get(index)===to)preview.delete(index);dialog.repaint();dialog.refreshGui?.();};announce();if(open&&dialog.isOpen()&&dialog.controller?.refreshParameters)dialog.controller.refreshParameters({whenIdle:pluginDialogIdle}).then(settleNoop,settleNoop);else settleNoop();return{laneId:controller.target.id,pluginIndex:plugin.index,index,value:to,noop:true};}
  if(!near(control.value,from))throw refused(`${name} is now ${pluginValueText(row,control)}: it changed elsewhere, so this step was not applied.`);
  await controller.parameter(plugin,index,to);if(controller.pluginMutation?.requiresInspection)throw Object.assign(new Error(`Freestyle did not confirm ${name} = ${to}. Inspect the plugin.`),{dispatched:true});
  // The instant preview value stays until the confirmed page read repaints (no flash back).
  // The GUI mirror captures a fresh frame (not a 304) once the window re-read has the new value.
  const settlePreview=()=>{const preview=dialog.controller?.historyPreviewValues;if(preview?.get(index)===to)preview.delete(index);dialog.repaint();dialog.refreshGui?.();};
  // Coalesced re-read of every loaded page: back-to-back ⌘Z/⌘⇧Z settle on the latest step's values.
  announce();if(open&&dialog.isOpen())dialog.controller.refreshParameters({whenIdle:pluginDialogIdle}).then(settlePreview,settlePreview);else settlePreview();clientLog('plugin-param-history',{index,from,to,open});return{laneId:controller.target.id,pluginIndex:plugin.index,index,value:to};
 };
 // FL: the knob shows the restored value at once; the guarded write confirms
 // it, and a refusal/failure reverts the knob (the confirmed read repaints).
 const previewUi=direction=>{const value=direction==='undo'?before:after,controller=dialog.controller;if(!controller||!dialog.isOpen())return null;const preview=controller.historyPreviewValues||=new Map();preview.set(index,value);dialog.repaint();
  // Pro: the engine hears the restored value now over mozart-control (set_plugin_param); the guarded save follows.
  let live='unavailable';try{live=controller.liveParameter(plugin,index,value,{flush:true});}catch{}
  clientLog('plugin-param-history-preview',{index,direction,value,live});return()=>{if(preview.get(index)===value)preview.delete(index);try{controller.liveParameter(plugin,index,direction==='undo'?after:before,{flush:true});}catch{}if(dialog.isOpen())dialog.repaint();};};
 return engine.patternHistory.recordExternalStep({kind:'plugin_parameter',label:`${name} – ${plugin.name||'Plugin'}`,scope,detail:{laneId:c?.laneId??null,pluginIndex:plugin.index,index,paramId,before,after},undo:()=>apply(after,before),redo:()=>apply(before,after),previewUi});
}
/** FL: the new automation clip is selected and scrolled into view. */
function revealSelectedAutomation(){const element=[...document.querySelectorAll('#track-lanes .automation-clip.selected')].at(0);if(!element)return false;try{element.scrollIntoView?.({block:'nearest',inline:'nearest'});}catch{}const row=element.closest('.track-lane,.automation-track'),index=[...($('#track-lanes')?.children||[])].indexOf(row);clientLog('automation-reveal',{key:element.dataset.envelopeKey,inline:element.classList.contains('automation-inline'),row:index});return true;}
function paintAutomationClips(){
 const host=$('#track-lanes');if(!host||!project)return;schedulePluginInventoryPrewarm();const scope=automationScopeKey();
 if(scope&&scope!==automationLoadScope&&logicAutomation?.enabled/* Disabelton: lazy, only in automation mode (A / Show Automation); writes load on demand */){automationLoadScope=scope;automationStore.bind(project.cloud?.projectId||project.id);automationStore.load({force:true}).catch(error=>{if(error?.code!=='automation_scope_changed')console.warn('[automation] list failed:',error?.message||error);});}
 if(!scope){host.querySelector(':scope > .automation-tracks')?.remove();paintLogicAutomation();return;}
 logAutomationRender();
 // Display only: empty Playlist rows with no lane binding (fixed-row layout is owned by cloud-session).
 const laneIds=project.cloud?.timelineLaneIds||[],freeRows=[...host.querySelectorAll(':scope > .track-lane')].map((row,index)=>({index,row,grid:row.querySelector('.lane-grid'),label:row.querySelector('.track-label')})).filter(item=>item.grid&&!laneIds[item.index]&&!item.grid.querySelector('.clip')&&!(project.clips||[]).some(clip=>clip.track===item.index)&&!(project.audioClips||[]).some(clip=>clip.track===item.index));
 const painted=paintAutomationTracks({freeRows,host,project,store:automationStore,selectedKey:selectedAutomationKey,onSelect:key=>{selectedAutomationKey=key;if(key&&playlistSelection.ids.size){playlistSelection.clear();selectedClip=null;paintPlaylistSelection();}paintAutomationClips();},onOpen:envelope=>openAutomation(null,envelope).catch(fail),onMenu:(event,envelope)=>{const current=project;const guarded=action=>()=>{if(project!==current&&(project?.cloud?.projectId||project?.id)!==(current.cloud?.projectId||current.id))return toast('The cloud project changed; reopen this menu.');return action();};menu(event,[['Edit automation points…','',guarded(()=>openAutomation(null,envelope))],['Delete automation clip','Del',guarded(()=>deleteAutomationClip(envelope))]]);}});
 {const placement=JSON.stringify({placed:painted?.placed||[],overflow:painted?.overflow||[]});if(placement!==automationPlacementSignature){automationPlacementSignature=placement;clientLog('automation-placement',JSON.parse(placement));}}
 paintLogicAutomation();
}
/** FL Delete on an automation clip: removes it at once as one Undo step (the host clip stays). */
async function deleteAutomationClip(envelope){if(!envelope)return;try{await automationHosts.remove({envelope});if(selectedAutomationKey===`${envelope.clipId}|${envelope.targetKey}`)selectedAutomationKey=null;paintAutomationClips();toast('Automation clip deleted in Freestyle.');}catch(error){fail(error);}}
/** FL "Create automation clip": persist an envelope in the lane's (selected) clip and show it on the Playlist. */
async function createAutomationClip({laneId,target,defaultValue,label}){
 if(!engine.ready)return openCloudPanel();const current=project,version=engine.loadVersion,projectId=current.cloud?.projectId||current.id;
 automationStore.bind(projectId);
 const host0=chooseAutomationHost(current,{laneId,selectedClipId:selectedClip,strictLane:target?.kind==='plugin_parameter'});
 clientLog('automation-create-request',{projectId,laneId,targetKind:target?.kind,targetKey:target?.kind==='plugin_parameter'?`${target.pluginInstanceId}:${target.stableParamId}`:'clip.gain',hostClipId:host0?(host0.patternId?'pattern:':'')+(host0.cloudId||host0.id):null,hostTrack:host0?.track??null,hostPatternId:host0?.patternId||null,storeLoaded:automationStore.loaded});
 let result;
 try{result=!host0&&target?.kind==='plugin_parameter'&&automationHostPlan(current,laneId)?await automationHosts.create({project:current,laneId,target,defaultValue,beat:automationPlayheadBeat()}):await createAutomationFromControl({store:automationStore,project:current,laneId,target,defaultValue,selectedClipId:selectedClip});}
 catch(error){clientLog('automation-create-error',{projectId,laneId,message:error.message,code:error.code||null,status:error.status||null});throw error;}
 const {envelope,host}=result;
 clientLog('automation-create-response',{projectId,clipId:envelope?.clipId,envelopeId:envelope?.id??null,persisted:envelope?.persisted===true,revision:envelope?.revision??null,targetKey:envelope?.targetKey,points:envelope?.points?.length??null,saveError:envelope?.saveError||null});
 if(!envelope?.persisted||!envelope.id)throw new Error('Freestyle did not return a saved automation clip (no envelope id). Nothing was created.');
 // Confirm the saved envelope through the canonical listing before claiming success.
 let listed=null;try{const data=await engine.session.call('list_automation',{project_id:projectId,clip_ids:[String(envelope.clipId)]});const rows=(data?.response??data)?.envelopes||[];listed=rows.some(row=>row?.id===envelope.id);clientLog('automation-create-verify',{clipId:envelope.clipId,envelopeId:envelope.id,listedCount:rows.length,listed,persistedIds:rows.filter(row=>row?.persisted).map(row=>row.id)});}
 catch(error){clientLog('automation-create-verify-error',{clipId:envelope.clipId,message:error.message,status:error.status||null});}
 if(project!==current&&engine.loadVersion!==version)return envelope;
 selectedAutomationKey=`${envelope.clipId}|${envelope.targetKey}`;showWindow('playlist');paintAutomationClips();revealSelectedAutomation();
 const hostName=host.name||automationHostClip(current,envelope.clipId)?.clip?.name||'the selected clip';
 if(listed===false)toast(`Freestyle returned automation ${envelope.id} but does not list it on ${hostName}. Reload the project to check.`);
 else toast(`Automation clip created: ${label||target.name||'parameter'} on ${hostName}.`);return envelope;
}
const AUTOMATION_UNSUPPORTED='Freestyle automation targets track volume/pan and lane plugin parameters only; this control has no automation API.';
const AUTOMATION_NO_BUS='Bus and master levels have no automation target yet: Freestyle automates track (lane) volume and pan.';
/** FL window for a new lane automation clip: the loop region, else 4 bars from the playhead's bar. */
function laneAutomationClipWindow(){const clock=engine.positionAt?.()||{};return laneAutomationWindow({bpm:Number(clock.bpm)||project?.bpm,beatsPerBar:project?.beatsPerBar,playheadBeat:automationPlayheadBeat(),loop:{enabled:!!clock.loopEnabled,startSec:clock.loopStartSec,endSec:clock.loopEndSec}});}
/** FL "Create automation clip" on a track fader / pan: a timeline lane envelope (createLaneAutomation), one Undo step. */
async function createLaneAutomationClip({laneId,target,defaultValue,label}){
 if(!engine.ready)return openCloudPanel();const current=project,version=engine.loadVersion,projectId=current.cloud?.projectId||current.id,span=laneAutomationClipWindow();
 automationStore.bind(projectId);clientLog('automation-lane-request',{projectId,laneId,targetKind:target.kind,startSec:span.startSec,durationSec:span.durationSec});
 let result;try{result=await automationHosts.createLane({laneId,target,defaultValue,startSec:span.startSec,durationSec:span.durationSec});}catch(error){clientLog('automation-create-error',{projectId,laneId,message:error.message,code:error.code||null,status:error.status||null});throw error;}
 const envelope=result.envelope;clientLog('automation-create-response',{projectId,clipId:envelope?.clipId,envelopeId:envelope?.id??null,persisted:envelope?.persisted===true,revision:envelope?.revision??null,targetKey:envelope?.targetKey,points:envelope?.points?.length??null,existing:!!result.existing});
 // Confirm the saved envelope through the lane's canonical listing before claiming success.
 let listed=null;try{const rows=await automationStore.readLane(laneId);listed=rows?rows.some(row=>row?.id===envelope.id):null;clientLog('automation-create-verify',{clipId:envelope.clipId,envelopeId:envelope.id,listedCount:rows?.length??null,listed});}catch(error){clientLog('automation-create-verify-error',{clipId:envelope.clipId,message:error.message,status:error.status||null});}
 if(project!==current&&engine.loadVersion!==version)return envelope;
 if(listed===false){selectedAutomationKey=null;paintAutomationClips();toast(`Freestyle returned automation ${envelope.id} but does not list it on this track. Reload the project to check.`);return envelope;}
 selectedAutomationKey=`${envelope.clipId}|${envelope.targetKey}`;showWindow('playlist');paintAutomationClips();revealSelectedAutomation();
 if(result.existing){toast(`${label||target.name} already has an automation clip on this track (Freestyle keeps one per track); opening it.`);openAutomation(null,envelope).catch(fail);}
 else toast(`Automation clip created: ${label||target.name}, bar ${1+span.startBeat/(project.beatsPerBar||4)}, ${Math.round(span.lengthBeats/(project.beatsPerBar||4)*100)/100} bars.`);
 return envelope;
}
/** Enabled whenever the control resolves to a real Freestyle target and host clip; otherwise disabled with the exact reason (hint + tooltip). */
function automationMenuItem(spec,reason=AUTOMATION_UNSUPPORTED){
 const unavailable=(hint,why)=>['Create automation clip',hint,()=>toast(why),true,why];
 if(!spec)return unavailable('no API target',reason);
 if(!engine.ready)return unavailable('open the cloud project','Open the Freestyle cloud project before creating automation.');
 if(spec.lane){const span=laneAutomationClipWindow(),perBar=project.beatsPerBar||4;return['Create automation clip',spec.hint||'',()=>createLaneAutomationClip(spec).catch(fail),false,`${spec.label||spec.target.name} → automation clip on the Playlist, bar ${1+span.startBeat/perBar}, ${Math.round(span.lengthBeats/perBar*100)/100} bars`];}
 const strictLane=spec.target?.kind==='plugin_parameter',host=chooseAutomationHost(project,{laneId:spec.laneId,selectedClipId:selectedClip,strictLane});
 const newHost=!host&&strictLane?automationHostPlan(project,spec.laneId,automationPlayheadBeat()):null;
 if(newHost)return['Create automation clip',spec.hint||'',()=>createAutomationClip(spec),false,`${spec.label||spec.target?.name||'Automation'} → new ${newHost.name} clip on ${newHost.laneName} at bar ${newHost.bar}`];
 if(!host){const laneName=project.channels?.find(channel=>!channel.patternSource&&String(channel.laneId)===String(spec.laneId))?.name||'this plugin’s track';return strictLane?unavailable(`no clip on ${laneName}’s own track`,`Freestyle stores plugin automation in a clip on the plugin’s own lane (${laneName}). Pattern placements that play this instrument sit on other tracks, so place a clip on ${laneName} first.`):unavailable('no clip on this track','Place a clip on this track first: Freestyle stores automation inside a timeline clip.');}
 return['Create automation clip',spec.hint||'',()=>createAutomationClip(spec),false,`${spec.label||spec.target?.name||'Automation'} → ${host.name||'the track’s first clip'}${spec.note?` · ${spec.note}`:''}`];
}
/** FL knob/fader menu: Copy value / Paste value between controls of the same kind (gain, pan, normalized plugin value). */
let controlValueClipboard=null;
function valueClipboardItems(kind,current,apply,locked=false){const copied=controlValueClipboard?.kind===kind;return[['Copy value','',()=>{if(!Number.isFinite(Number(current())))throw new Error('This control has no known value to copy.');controlValueClipboard={kind,value:Number(current())};toast('Value copied.');},!Number.isFinite(Number(current()))],['Paste value',copied?formatClipboardValue(kind,controlValueClipboard.value):'',()=>apply(controlValueClipboard.value),locked||!copied]];}
function formatClipboardValue(kind,value){return kind==='gain'?`${value>0?(20*Math.log10(value)).toFixed(1):'-∞'} dB`:kind==='pan'?`${Math.round(value*100)}%`:`${Math.round(value*100)}%`;}
function mixerAutomationItem(row,control){if(row?.kind!=='lane')return automationMenuItem(null,AUTOMATION_NO_BUS);return automationMenuItem(control==='pan'?lanePanAutomation(row.id,row.name,row.values?.pan?.value):laneGainAutomation(row.id,row.name,row.values?.gain?.value));}
function pluginParameterAutomation(controller,plugin,parameter){
 const instance=plugin?.instance_id??plugin?.instanceId??plugin?.id,laneId=controller?.target?.kind==='lane'?controller.target.id:null;
 if(!parameter||parameter.automatable===false||!laneId||typeof instance!=='string'||!instance||typeof parameter.id!=='string'||!parameter.id)return null;
 return{laneId,target:{kind:'plugin_parameter',pluginInstanceId:instance,pluginIndex:plugin.index,paramIndex:parameter.index,stableParamId:parameter.id,name:parameter.name||`Parameter ${parameter.index}`,unit:parameter.unit||''},defaultValue:Number.isFinite(Number(parameter.value))?Math.max(0,Math.min(1,Number(parameter.value))):.5,label:`${plugin.name||'Plugin'} ${parameter.name||parameter.index}`,hint:'plugin'};
}
/**
 * Studio API saved lane chains (get_project lanes[].pluginChain) carry the slot as
 * `position` and the instance as `pluginKey`; list_plugins reports the same slot as
 * index/instance_id. pluginDialog's ensurePlugin verifies that live identity before
 * any parameter read, editor binding or edit, so a stale saved chain cannot write.
 */
function savedChainPlugins(chain){
 const rows=Array.isArray(chain)?chain:[],slots=new Set(),plugins=[];
 for(const item of rows){if(!item||typeof item!=='object'||!Number.isInteger(item.position)||item.position<0||typeof item.pluginKey!=='string'||!item.pluginKey||slots.has(item.position))return[];slots.add(item.position);plugins.push({...item,index:item.position,instance_id:item.pluginKey,...(typeof item.type==='string'&&item.type?{type_id:item.type}:{}),name:item.name||item.type||'Cloud plugin',bypassed:item.bypassed===true,savedChain:true});}
 return plugins.sort((a,b)=>a.index-b.index);
}
/** The channel's plugin window target: a live indexed slot, else an instrument channel's saved instrument slot. */
function channelPlugin(c){
 if(!c?.plugins?.length)return null;
 const live=normalizeLoadedPlugins(c.plugins).find(plugin=>plugin.index!==null&&plugin.index>=0);if(live)return live;
 return c.type==='instrument'?savedChainPlugins(c.plugins).find(plugin=>!/^native-/.test(plugin.type_id||''))||null:null;
}
/** FL channel button: one click toggles the channel's plugin window. */
function togglePluginWindow(id){
 const c=project.channels.find(item=>item.id===id),plugin=channelPlugin(c);if(!plugin||!engine.ready)return false;
 const open=[...document.querySelectorAll('dialog.plugin-parameter-dialog')].find(d=>d.dataset.pluginChannel===id&&d.open);
 if(open){open.close();return true;}
 pluginDialog(c,plugin,{nativeFirst:true}).catch(fail);return true;
}
/** FL track volume automation. Freestyle stores it as the host clip's gain envelope (lane-wide volume automation is an open engine request). */
/** Parameter label text for `value`: the engine display when it describes that value, else a local percent/physical rendering. */
/** A parameter's current value as the plug-in shows it ("−24.32 dB"), never a raw normalized float. */
function pluginValueText(parameter,control){return formatPluginValueText(parameterDisplay(parameter,control,control?.value),parameter?.unit??control?.unit);}
function parameterDisplay(parameter,control,value){
 const display=String(parameter?.display??'').trim(),reported=control?.value;
 if(!Number.isFinite(value))return display;
 if(Number.isFinite(reported)&&Math.abs(reported-value)<1e-9&&display&&!/^-?\d+(?:\.\d+)?\s*%$/.test(display))return display;
 if(control?.form==='physical')return `${Math.round(value*100)/100}${control.unit?` ${control.unit}`:''}`;
 if(/%\s*$/.test(display)||!display)return `${Math.round(value*100)}%`;
 return Number.isFinite(reported)&&Math.abs(reported-value)<1e-9?display:`${Math.round(value*100)}%`;
}
/** Current saved/live lane mixer value, for the flat curve a new automation clip starts with. */
function laneMixValue(laneId,control,fallback){const value=currentMixerModel().rows.find(row=>row.kind==='lane'&&row.id===laneId)?.values?.[control]?.value;return Number.isFinite(Number(value))?Number(value):fallback;}
function laneGainAutomation(laneId,name,gain=laneId?laneMixValue(laneId,'gain',1):1){return laneId?{lane:true,laneId,target:{kind:'lane_volume',name:'Volume'},defaultValue:laneVolumeValue(gain),label:`${name||'Track'} Volume`,hint:'Volume'}:null;}
function lanePanAutomation(laneId,name,pan=laneId?laneMixValue(laneId,'pan',0):0){return laneId?{lane:true,laneId,target:{kind:'lane_pan',name:'Pan'},defaultValue:lanePanValue(pan),label:`${name||'Track'} Pan`,hint:'Pan'}:null;}

let lastNonzeroSnap=Number($('#snap').value)||.25;
$('#snap').addEventListener('change',()=>{const value=Number($('#snap').value);if(Number.isFinite(value)&&value>0)lastNonzeroSnap=value;activePianoCancel?.();activePlaylistCancel?.();});
function toggleSnap(){const input=$('#snap'),current=Number(input.value);if(current>0){lastNonzeroSnap=current;input.value='0';}else input.value=String(lastNonzeroSnap);input.dispatchEvent(new Event('change',{bubbles:true}));toast(Number(input.value)>0?`Snap: ${input.selectedOptions[0]?.textContent||input.value}`:'Snap: None');}
function pianoSnapOptions(){return{mainSnap:Number((s=>s.dataset.ablAdaptive===s.value&&s.dataset.ablMainSnap!=null?s.dataset.ablMainSnap:s.value)($('#snap'))),gridBeats:.25,beatsPerBar:4};}
function pianoSnap(){return resolvePianoSnap(pianoSnapMode,pianoSnapOptions());}
function quantizePiano(beat,{bypass=false}={}){return quantizePianoPosition(Math.max(0,beat),bypass?'none':pianoSnapMode,pianoSnapOptions());}
function setPianoSnap(mode){
 if(!PIANO_SNAP_MODES.some(item=>item.id===mode))return;
 activePianoCancel?.();pianoSnapMode=mode;const button=$('#piano-snap'),label=PIANO_SNAP_MODES.find(item=>item.id===mode).label;
 button.title=`Snap to grid: ${label}`;button.textContent=mode==='main'?'Smart':label;button.setAttribute('aria-label',`Piano snap: ${label}`);button.dataset.localSnap=String(mode!=='main');button.setAttribute('aria-expanded','false');toast(`Piano snap: ${label}`);
}
function pianoSnapMenu(event){
 activePianoCancel?.();const button=$('#piano-snap'),bounds=button.getBoundingClientRect();
 menu({clientX:bounds.left,clientY:bounds.bottom},PIANO_SNAP_MODES.map(item=>[item.label,item.id===pianoSnapMode?'✓':'',()=>setPianoSnap(item.id)]));
 const popup=$('#context-menu'),buttons=[...popup.querySelectorAll('button')];button.setAttribute('aria-expanded','true');popup.setAttribute('role','menu');
 buttons.forEach((item,index)=>{item.setAttribute('role','menuitemradio');item.setAttribute('aria-checked',String(PIANO_SNAP_MODES[index].id===pianoSnapMode));});
 const finish=()=>{button.setAttribute('aria-expanded','false');popup.removeEventListener('keydown',keys);document.removeEventListener('pointerdown',outside,true);popup.removeEventListener('click',chosen);if(pianoSnapMenuCancel===finish)pianoSnapMenuCancel=null;};pianoSnapMenuCancel=finish;
 const outside=e=>{if(!popup.contains(e.target))finish();};
 const keys=e=>{const index=buttons.indexOf(document.activeElement);if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();e.stopPropagation();buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length].focus();}else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();popup.classList.add('hidden');finish();button.focus();}else if(['Enter',' '].includes(e.key)){e.preventDefault();e.stopPropagation();document.activeElement?.click();}};
 const chosen=()=>{finish();button.focus();};popup.addEventListener('keydown',keys);document.addEventListener('pointerdown',outside,true);popup.addEventListener('click',chosen,{once:true});buttons[PIANO_SNAP_MODES.findIndex(item=>item.id===pianoSnapMode)]?.focus();
}
function quantize(n,grid=+$('#snap').value){const value=Number(n);if(!Number.isFinite(value))return 0;return Math.max(0,Number.isFinite(grid)&&grid>0?Math.round(value/grid)*grid:value);}
function playlistEditable(){if(workspaceBusy()&&!importEditGate()){toast('Wait for the cloud operation to finish.');return false;}if(rackClipboardBusy){toast('Wait for the Channel Rack clipboard operation to finish.');return false;}if(rackGraph?.writing){toast('Wait for the step velocity edit to finish.');return false;}if(rangeBusy()||sliceBusy()||cloudLibrary?.writeBusy||engine.editBlocked||engine.loading){toast('Wait for the current cloud operation to finish.');return false;}if(!engine.ready){toast('Select or create a Freestyle project first.');openCloudPanel().catch(fail);return false;}return true;}
const playlistStroke=new PlaylistStrokeGesture({getProject:()=>project,getPattern:pattern,getTool:()=>tool,getScope:()=>({projectId:engine.projectId,trackId:engine.session.trackId,load:engine.loadVersion||0,context:engine.session.contextVersion||0,edit:audioRangeRevision,barWidth}),
 pointForEvent:event=>{const bounds=$('#playlist .lane-grid').getBoundingClientRect(),height=$('.track-lane').getBoundingClientRect().height||playlistLaneHeight;return{beat:(event.clientX-bounds.left)/barWidth*4,row:playlistLayout.rowAt(event.clientY-bounds.top,height)};},
 canStart:()=>playlistEditable(),canContinue:()=>engine.ready&&!engine.loading&&!engine.editBlocked&&!rangeBusy()&&!sliceBusy()&&!cloudLibrary?.writeBusy,
 onStart:({pointerId})=>{engine.interacting=true;activePlaylistCancel=Object.assign(()=>playlistStroke.cancel(),{pointerId});},
 paint:result=>{for(const clip of result.created){if(playlistStrokeMarkers.has(clip.id))continue;const lane=$$('#playlist .lane-grid').find(node=>Number(node.dataset.track)===clip.track);if(!lane)continue;const marker=document.createElement('div');marker.className='clip playlist-stroke-preview';marker.style.cssText=`left:${clip.start/4*barWidth}px;width:${clip.length/4*barWidth}px;background:${colors[project.patterns.indexOf(pattern())%colors.length]};border-color:${colors[project.patterns.indexOf(pattern())%colors.length]}`;marker.innerHTML=`<div class="clip-title">▸ ${esc(pattern().name)}</div>${patternSvg(pattern())}`;lane.append(marker);playlistStrokeMarkers.set(clip.id,marker);}for(const node of $$('#playlist .clip[data-clip]'))if(result.erased.has(node.dataset.clip)&&!playlistStrokeVisibility.has(node)){playlistStrokeVisibility.set(node,node.style.visibility);node.style.visibility='hidden';}},
 restore:()=>{for(const marker of playlistStrokeMarkers.values())marker.remove();playlistStrokeMarkers.clear();for(const [node,visibility]of playlistStrokeVisibility)node.style.visibility=visibility;playlistStrokeVisibility.clear();},
 onFinish:()=>{activePlaylistCancel=null;engine.interacting=false;const element=playlistStrokeElement,pointerId=playlistStrokePointer;playlistStrokeElement=null;playlistStrokePointer=null;if(element){element.onpointermove=element.onpointerup=element.onpointercancel=element.onlostpointercapture=null;try{if(element.hasPointerCapture?.(pointerId))element.releasePointerCapture(pointerId);}catch{}}},
 commit:result=>{const added=(result.clips||[]).length-(project.clips||[]).length,hint=added>0?`Paint pattern ${added===1?'clip':'clips'}`:null;if(hint)engine.patternHistory.hintLabel?.(hint);const done=edit(()=>{project.clips=result.clips;project.audioClips=result.audioClips;});if(hint&&!done)engine.patternHistory.hintLabel?.(null);return done;},onError:fail,
 createAutoScroll:options=>new PlaylistAutoScroll({viewport:$('#arrangement-scroll'),getInsets:()=>({left:PLAYLIST_GUTTER,top:$('#timeline-ruler').getBoundingClientRect().height||24}),...options})});
function startPlaylistStroke(event,element,mode){
 if(event.isPrimary===false)return false;activeRackCancel?.();activePlaylistCancel?.();event.preventDefault();event.stopPropagation();playlistStrokeElement=element;playlistStrokePointer=event.pointerId;
 if(!playlistStroke.start(event,{mode,...mode==='paint'&&(event.altKey||Number($('#snap').value)===0)?{tileOrigin:Math.max(0,playlistStroke.pointForEvent(event).beat)}:{}})){playlistStrokeElement=null;playlistStrokePointer=null;return false;}
 element.setPointerCapture?.(event.pointerId);element.onpointermove=event=>playlistStroke.move(event);element.onpointerup=event=>playlistStroke.finish(event);element.onpointercancel=event=>playlistStroke.pointerCancel(event);element.onlostpointercapture=event=>playlistStroke.lostPointerCapture(event);return true;
}
function paintLane(event,lane){return startPlaylistStroke(event,lane,'paint');}
function playlistDraw(event,lane){
 if(event.isPrimary===false||event.button!==0)return false;event.preventDefault();event.stopPropagation();activePlaylistCancel?.();activePianoCancel?.();activeRackCancel?.();
 if(!playlistEditable()){engine.interacting=false;return false;}
 const current=project,p=pattern(),scope=JSON.stringify(fileImportScope()),patternState=JSON.stringify(p),viewport=$('#arrangement-scroll'),scale=barWidth,rowHeight=lane.closest('.track-lane').getBoundingClientRect().height||playlistLaneHeight,snap=+$('#snap').value,snapMode=$('#snap').value,grid=event.altKey?0:snap,track=+lane.dataset.track,rect=lane.getBoundingClientRect(),scroll={left:viewport.scrollLeft,top:viewport.scrollTop};
 let initial;try{initial=paintedPatternPlacement({project,pattern:p,track,start:quantize((event.clientX-rect.left)/scale*4,grid),id:uid()});}catch(error){engine.interacting=false;toast(error.message);return false;}
 const marker=document.createElement('div');marker.className='clip playlist-draw-preview';marker.dataset.previewClip=initial.id;marker.setAttribute('aria-hidden','true');const color=colors[project.patterns.indexOf(p)%colors.length];marker.style.cssText=`left:${initial.start/4*scale}px;width:${initial.length/4*scale}px;background:${color};border-color:${color}`;marker.innerHTML=`<div class="clip-title">▸ ${esc(p.name)}</div>${patternSvg(p)}`;lane.append(marker);
 const valid=()=>project===current&&pattern()===p&&JSON.stringify(p)===patternState&&scope===JSON.stringify(fileImportScope())&&tool==='draw'&&barWidth===scale&&$('#snap').value===snapMode&&lane.isConnected&&engine.ready&&!engine.loading&&!engine.editBlocked&&!rangeBusy()&&!sliceBusy()&&!cloudLibrary?.writeBusy;
 const contentPoint=sample=>({clientX:sample.clientX+viewport.scrollLeft-scroll.left,clientY:sample.clientY+viewport.scrollTop-scroll.top,pointerId:event.pointerId}),matches=sample=>sample?.pointerId==null||sample.pointerId===event.pointerId;
 const painter=new ClipGesturePainter({element:marker,initial,origin:{clientX:event.clientX,clientY:event.clientY,pointerId:event.pointerId},pixelsPerBeat:scale/4,rowHeight,isValid:valid,compute:({deltaX,deltaY})=>computePlaylistGesture(initial,{deltaBeats:deltaX/scale*4,deltaTracks:playlistLayout.trackDelta(deltaY,rowHeight,event.clientY),snapBeats:grid,maxTrack:$$('.track-lane').length-1,bpm:current.bpm})});
 let finished=false,physical=event;const auto=new PlaylistAutoScroll({viewport,pointerId:event.pointerId,getInsets:()=>({left:PLAYLIST_GUTTER,top:$('#timeline-ruler').getBoundingClientRect().height||24}),isValid:valid,onScroll:()=>painter.move(contentPoint(physical))});auto.update(event,{enabled:false});
 const finish=(cancel,sample)=>{
  if(finished||!matches(sample))return;finished=true;auto.destroy();const point=Number.isFinite(sample?.clientX)&&Number.isFinite(sample?.clientY)?sample:physical;let result;
  try{result=painter.finish(contentPoint(point),{cancel});}catch(error){painter.finish(undefined,{cancel:true});toast(error.message);}
  marker.remove();if(activePlaylistCancel===cancelGesture){activePlaylistCancel=null;engine.interacting=false;lane.onpointermove=lane.onpointerup=lane.onpointercancel=lane.onlostpointercapture=null;try{if(lane.hasPointerCapture?.(event.pointerId))lane.releasePointerCapture(event.pointerId);}catch{}}
  if(!result||result.cancelled||!valid())return;edit(()=>{project.clips.push(result.state);playlistSelection.sync(project);playlistSelection.select([result.state.id]);selectedClip=result.state.id;});
 };
 const cancelGesture=Object.assign(()=>finish(true),{pointerId:event.pointerId});activePlaylistCancel=cancelGesture;engine.interacting=true;try{lane.setPointerCapture?.(event.pointerId);}catch{}
 lane.onpointermove=sample=>{if(!matches(sample)||!Number.isFinite(sample?.clientX)||!Number.isFinite(sample?.clientY))return;if(!valid()){finish(true);return;}physical=sample;painter.move(contentPoint(sample));auto.update(sample,{enabled:painter.moved});};lane.onpointerup=sample=>finish(false,sample);lane.onpointercancel=lane.onlostpointercapture=sample=>finish(true,sample);return true;
}
function playlistPoint(event){const grid=$('#playlist .lane-grid'),bounds=grid?.getBoundingClientRect(),height=$('.track-lane')?.getBoundingClientRect().height||playlistLaneHeight;if(!bounds||!Number.isFinite(event?.clientX)||!Number.isFinite(event?.clientY))throw new Error('The Playlist pointer position is unavailable.');return{beat:Math.max(0,(event.clientX-bounds.left)/barWidth*4),row:Math.max(0,playlistLayout.rowAt(event.clientY-bounds.top,height))};}
function playlistView(){const viewport=$('#arrangement-scroll');return{scale:barWidth,rowHeight:playlistLaneHeight,scrollLeft:viewport.scrollLeft,scrollTop:viewport.scrollTop};}
function applyPlaylistView(view){/* Disabelton: Live's compact track height is ~22 px */playlistLaneHeight=Math.max(20,Math.min(240,view.rowHeight));document.documentElement.style.setProperty('--lane',`${playlistLaneHeight}px`);timelineViewport.setView(view);syncPlaylistCursorViewport();playlistNavigator?.refresh();queueCloudWaveforms();}
/** Visible zoom-to-fit (the Zoom tool's right-click): the whole song in view;
 * a second click returns to the previous view. Presentation only, no edit. */
function fitPlaylistView(){
 const viewport=$('#arrangement-scroll'),width=viewport.clientWidth-PLAYLIST_GUTTER,height=viewport.clientHeight-($('#timeline-ruler').getBoundingClientRect().height||24);if(width<=0||height<=0)return false;
 const current=playlistView(),end=Math.max(16,...allClips().map(clip=>clip.start+clip.length)),rows=Math.max(1,...allClips().map(clip=>clip.track+1)),next=playlistZoomPrevious||{scale:width*4/end,rowHeight:Math.max(28,Math.min(80,height/rows)),scrollLeft:0,scrollTop:0};
 playlistZoomPrevious=current;applyPlaylistView(next);return true;
}
/** Edit ▸ Clear playlist…: removes every pattern clip after an explicit confirmation (one Undo step). */
function clearPlaylistConfirm(){
 const count=(project.clips||[]).length;if(!count)return toast('The Playlist has no pattern clips to clear.');
 const d=dialog('Clear playlist',`<form><p>Clear all ${count} pattern clip${count===1?'':'s'} from the playlist? Undo brings them back.</p><button type="submit" class="primary">Clear</button><button type="button" class="cancel">Cancel</button></form>`);
 d.querySelector('.cancel').onclick=()=>d.close();d.querySelector('form').onsubmit=event=>{event.preventDefault();d.close();engine.patternHistory?.hintLabel?.('Clear playlist');if(!edit(()=>{project.clips=[];}))engine.patternHistory?.hintLabel?.(null);};d.querySelector('.cancel').focus?.();
}
function playlistZoom(event,element){
 if(event.isPrimary===false||![0,2].includes(event.button))return false;event.preventDefault();event.stopPropagation();activePlaylistCancel?.();activeRackCancel?.();activePianoCancel?.();
 const viewport=$('#arrangement-scroll'),width=viewport.clientWidth-PLAYLIST_GUTTER,height=viewport.clientHeight-($('#timeline-ruler').getBoundingClientRect().height||24);if(width<=0||height<=0)return false;
 if(event.button===2&&!event.ctrlKey&&!event.metaKey){const current=playlistView(),end=Math.max(16,...allClips().map(clip=>clip.start+clip.length)),rows=Math.max(1,...allClips().map(clip=>clip.track+1)),next=playlistZoomPrevious||{scale:width*4/end,rowHeight:Math.max(28,Math.min(80,height/rows)),scrollLeft:0,scrollTop:0};playlistZoomPrevious=current;applyPlaylistView(next);return true;}
 const current=project,version=engine.loadVersion,context=engine.session.contextVersion||0,before=playlistView(),originalTool=tool,origin=playlistPoint(event),marker=document.createElement('div');marker.className='playlist-zoom-rect';marker.setAttribute('aria-hidden','true');$('#arrangement').append(marker);let point=origin,physical=event,frame=null,moved=false,finished=false;
 const valid=()=>project===current&&engine.loadVersion===version&&(engine.session.contextVersion||0)===context&&tool===originalTool&&barWidth===before.scale&&playlistLaneHeight===before.rowHeight;
 const paint=()=>{frame=null;if(!valid())return;marker.style.cssText=`left:${PLAYLIST_GUTTER+Math.min(origin.beat,point.beat)*barWidth/4}px;top:${($('#timeline-ruler').getBoundingClientRect().height||24)+Math.min(origin.row,point.row)*playlistLaneHeight}px;width:${Math.abs(point.beat-origin.beat)*barWidth/4}px;height:${Math.abs(point.row-origin.row)*playlistLaneHeight}px`;};
 const sample=next=>{if(!Number.isFinite(next?.clientX)||!Number.isFinite(next?.clientY)||next.pointerId!=null&&next.pointerId!==event.pointerId)return;physical=next;point=playlistPoint(next);if(Math.hypot((point.beat-origin.beat)*barWidth/4,(point.row-origin.row)*playlistLaneHeight)>=4)moved=true;};
 const auto=new PlaylistAutoScroll({viewport,pointerId:event.pointerId,getInsets:()=>({left:PLAYLIST_GUTTER,top:$('#timeline-ruler').getBoundingClientRect().height||24}),isValid:valid,onScroll:()=>{sample(physical);if(frame===null)frame=requestAnimationFrame(paint);}});auto.update(event,{enabled:false});
 const finish=(cancel,next)=>{if(finished||next?.pointerId!=null&&next.pointerId!==event.pointerId)return;finished=true;if(!cancel)sample(next);auto.destroy();if(frame!==null)cancelAnimationFrame(frame);marker.remove();activePlaylistCancel=null;element.onpointermove=element.onpointerup=element.onpointercancel=element.onlostpointercapture=null;try{if(element.hasPointerCapture?.(event.pointerId))element.releasePointerCapture(event.pointerId);}catch{}engine.interacting=false;if(cancel||!valid()||!moved)return;const start=Math.min(origin.beat,point.beat),span=Math.abs(point.beat-origin.beat),top=Math.floor(Math.min(origin.row,point.row)),bottom=Math.max(top+1,Math.ceil(Math.max(origin.row,point.row))),scale=span*barWidth/4>=4?Math.max(timelineViewport.min,Math.min(timelineViewport.max,width*4/span)):barWidth,rowHeight=Math.max(28,Math.min(240,height/(bottom-top)));playlistZoomPrevious=before;applyPlaylistView({scale,rowHeight,scrollLeft:start*scale/4,scrollTop:top*rowHeight});};
 engine.interacting=true;activePlaylistCancel=Object.assign(()=>finish(true),{pointerId:event.pointerId});element.setPointerCapture?.(event.pointerId);element.onpointermove=next=>{if(next.pointerId!=null&&next.pointerId!==event.pointerId)return;sample(next);auto.update(next,{enabled:moved});if(frame===null)frame=requestAnimationFrame(paint);};element.onpointerup=next=>finish(false,next);element.onpointercancel=element.onlostpointercapture=next=>finish(true,next);return true;
}
let playlistPlayVersion=0;
async function playlistPlayback(event,element){
 if(modeSwitchPending||stopRequest){toast('Wait for playback to stop before pressing Play.');return false;}
 if(event.isPrimary===false||event.button!==0)return false;event.preventDefault();event.stopPropagation();activePlaylistCancel?.();if(element.closest('.clip')){toast('Isolated clip audition is not available through the current cloud controls. Click empty Playlist space to play the arrangement from there.');return false;}
 if(!playlistEditable())return false;const beat=playlistPoint(event).beat,scope={projectId:engine.projectId,trackId:engine.session.trackId,load:engine.loadVersion,context:engine.session.contextVersion||0},version=++playlistPlayVersion,current=()=>version===playlistPlayVersion&&engine.ready&&scope.projectId===engine.projectId&&scope.trackId===engine.session.trackId&&scope.load===engine.loadVersion&&scope.context===(engine.session.contextVersion||0);setPlaylistCursor(beat);
 try{if(mode!=='song'||engine.previewing){if(await stop()===false||!current())return false;}setPlaylistCursor(beat);mode='song';$('#mode').classList.add('song');const statusScope=playbackUiScope(),statusVersion=transportUiVersion,playing=engine.play(project,'song',{startSeconds:beat*60/project.bpm});paintTransportBusy();await playing;if(!current())return false;$('#play').classList.add('playing');$('#play').textContent='Ⅱ';$('#status-message').textContent='Playing arrangement from the Arrangement cursor';rememberSongPlayingStatus($('#status-message').textContent,statusScope,statusVersion);startTransportFrames();return true;}catch(error){fail(error);return false;}finally{paintTransportBusy();}
}
function playlistMuteStroke(event,element){
 event.preventDefault();event.stopPropagation();activePlaylistCancel?.();if(!playlistEditable())return false;const clip=findClip(element.dataset.clip);if(!clip)return false;
 const current=project,version=engine.loadVersion,context=engine.session.contextVersion||0,editVersion=audioRangeRevision,clickedAudioMute=clip.patternId?false:audioClipMuteValue(clip.id);if(clickedAudioMute===null){fail(new Error('Reload the saved clip mute before toggling it.'));return false;}const muted=clip.patternId?!clip.cloudRaw?.muted:!clickedAudioMute,ids=new Set(),styles=new Map(),origin=playlistPoint(event);let last=origin,plan=null,audioPlan=null,finished=false;
 const valid=()=>project===current&&engine.loadVersion===version&&(engine.session.contextVersion||0)===context&&audioRangeRevision===editVersion&&engine.ready&&!engine.loading&&!engine.editBlocked&&!workspaceBusy()&&!rangeBusy()&&!sliceBusy()&&tool==='mute';
 const intersects=(a,b,c)=>{let low=0,high=1;for(const[value,delta,min,max]of [[a.beat,b.beat-a.beat,c.start,c.start+c.length],[a.row,b.row-a.row,c.track,c.track+1]]){if(delta===0){if(value<min||value>max)return false;continue;}let left=(min-value)/delta,right=(max-value)/delta;if(left>right)[left,right]=[right,left];low=Math.max(low,left);high=Math.min(high,right);if(low>high)return false;}return true;};
 const sample=next=>{if(next?.pointerId!=null&&next.pointerId!==event.pointerId)return;const point=playlistPoint(next),hits=allClips().filter(candidate=>intersects(last,point,candidate));last=point;for(const hit of hits)ids.add(hit.id);ids.add(clip.id);const audioIds=new Set((current.audioClips||[]).map(item=>item.id)),patternIds=[...ids].filter(id=>!audioIds.has(id)),audioClipIds=[...ids].filter(id=>audioIds.has(id));const nextPlan=patternIds.length?planPatternClipMute(current,{clipIds:patternIds,muted}):null,nextAudioPlan=audioClipIds.length?planAudioClipMute(current,{clipIds:audioClipIds,muted}):null;plan=nextPlan;audioPlan=nextAudioPlan;for(const id of ids){const node=$$('#playlist .clip[data-clip]').find(node=>node.dataset.clip===id);if(node){if(!styles.has(node))styles.set(node,{preview:node.classList.contains('muted-preview'),muted:node.classList.contains('muted-item')});node.classList.toggle('muted-preview',muted);node.classList.toggle('muted-item',muted);}}};
 const finish=(cancel,next)=>{if(finished||next?.pointerId!=null&&next.pointerId!==event.pointerId)return;finished=true;let error;try{if(!cancel&&valid())sample(next||event);}catch(caught){cancel=true;error=caught;}activePlaylistCancel=null;element.onpointermove=element.onpointerup=element.onpointercancel=element.onlostpointercapture=null;try{if(element.hasPointerCapture?.(event.pointerId))element.releasePointerCapture(event.pointerId);}catch{}engine.interacting=false;for(const[node,classes]of styles){node.classList.toggle('muted-preview',classes.preview);node.classList.toggle('muted-item',classes.muted);}if(error)fail(error);if(cancel||!valid())return;if(plan?.changed&&!edit(()=>{project=plan.project;}))return;if(audioPlan?.changed)commitAudioClipMutes(audioPlan.changes).catch(fail);};
 try{sample(event);}catch(error){fail(error);return false;}engine.interacting=true;activePlaylistCancel=Object.assign(()=>finish(true),{pointerId:event.pointerId});element.setPointerCapture?.(event.pointerId);element.onpointermove=next=>{if(next.pointerId!=null&&next.pointerId!==event.pointerId)return;if(!valid())return finish(true);try{sample(next);}catch(error){finish(true);fail(error);}};element.onpointerup=next=>finish(false,next);element.onpointercancel=element.onlostpointercapture=next=>finish(true,next);return true;
}
function marqueePlaylist(e,lane){
 activePlaylistCancel?.();e.preventDefault();const current=project,version=engine.loadVersion,initial=playlistSelection.ids,origin={x:e.clientX,y:e.clientY},base=$('#playlist .lane-grid').getBoundingClientRect(),originBeat=(e.clientX-base.left)/barWidth*4,rowHeight=$('.track-lane').getBoundingClientRect().height||playlistLaneHeight,arrangement=$('#arrangement'),bounds=arrangement.getBoundingClientRect(),originRow=playlistLayout.rowAt(e.clientY-base.top,rowHeight);
 const marker=document.createElement('div');marker.className='playlist-marquee';marker.setAttribute('aria-hidden','true');arrangement.append(marker);let point={x:e.clientX,y:e.clientY},frame=null,moved=false,finished=false;
 const valid=()=>project===current&&engine.loadVersion===version;
 const paint=()=>{frame=null;if(!valid())return;const liveBounds=arrangement.getBoundingClientRect(),liveBase=$('#playlist .lane-grid').getBoundingClientRect(),originX=origin.x-bounds.left,originY=origin.y-bounds.top,pointX=point.x-liveBounds.left,pointY=point.y-liveBounds.top;marker.style.cssText=`left:${Math.min(originX,pointX)}px;top:${Math.min(originY,pointY)}px;width:${Math.abs(pointX-originX)}px;height:${Math.abs(pointY-originY)}px`;const hits=playlistClipIdsInRect(allClips(),{left:originBeat,right:(point.x-liveBase.left)/barWidth*4,top:originRow,bottom:playlistLayout.rowAt(point.y-liveBase.top,rowHeight)});playlistSelection.select(initial);playlistSelection.select(hits,{mode:e.shiftKey?'add':'replace'});selectedClip=playlistSelection.ids.values().next().value||null;paintPlaylistSelection();};
 const sample=event=>{if(!Number.isFinite(event?.clientX)||!Number.isFinite(event?.clientY)||event.pointerId!=null&&event.pointerId!==e.pointerId)return;if(!moved&&Math.hypot(event.clientX-origin.x,event.clientY-origin.y)<3)return;moved=true;point={x:event.clientX,y:event.clientY};};
 const autoscroll=new PlaylistAutoScroll({viewport:$('#arrangement-scroll'),pointerId:e.pointerId,getInsets:()=>({left:PLAYLIST_GUTTER,top:$('#timeline-ruler').getBoundingClientRect().height||24}),isValid:valid,onScroll:()=>{if(moved&&frame===null)frame=requestAnimationFrame(paint);}});autoscroll.update(e,{enabled:false});
 const finish=(cancel,event)=>{if(finished||event?.pointerId!=null&&event.pointerId!==e.pointerId)return;finished=true;autoscroll.destroy();activePlaylistCancel=null;if(!cancel)sample(event);if(frame!==null)cancelAnimationFrame(frame);if(valid()){if(cancel)playlistSelection.select(initial);else if(moved)paint();else if(!e.shiftKey)playlistSelection.clear();selectedClip=playlistSelection.ids.values().next().value||null;paintPlaylistSelection();}marker.remove();try{if(lane.hasPointerCapture?.(e.pointerId))lane.releasePointerCapture(e.pointerId);}catch{}lane.onpointermove=lane.onpointerup=lane.onpointercancel=lane.onlostpointercapture=null;engine.interacting=false;};
 activePlaylistCancel=Object.assign(()=>finish(true),{pointerId:e.pointerId});engine.interacting=true;lane.setPointerCapture?.(e.pointerId);lane.onpointermove=event=>{sample(event);autoscroll.update(event,{enabled:moved});if(moved&&frame===null)frame=requestAnimationFrame(paint);};lane.onpointerup=event=>finish(false,event);lane.onpointercancel=lane.onlostpointercapture=event=>finish(true,event);
}
function playlistClipSelect(event,element,clip){
 const before=playlistSelection.ids,current=project,scope=JSON.stringify(fileImportScope()),origin={x:event.clientX,y:event.clientY},matches=sample=>sample?.pointerId==null||sample.pointerId===event.pointerId;let moved=false;
 marqueePlaylist(event,element);const move=element.onpointermove,up=element.onpointerup;
 element.onpointermove=sample=>{if(matches(sample)&&Number.isFinite(sample?.clientX)&&Number.isFinite(sample?.clientY)&&Math.hypot(sample.clientX-origin.x,sample.clientY-origin.y)>=3)moved=true;move(sample);};
 element.onpointerup=sample=>{if(!matches(sample))return;if(Number.isFinite(sample?.clientX)&&Number.isFinite(sample?.clientY)&&Math.hypot(sample.clientX-origin.x,sample.clientY-origin.y)>=3)moved=true;up(sample);if(!moved&&project===current&&scope===JSON.stringify(fileImportScope())&&findClip(clip.id)===clip){playlistSelection.select(before);playlistSelection.select([clip.id],{mode:event.shiftKey?'toggle':'replace'});selectedClip=playlistSelection.has(clip.id)?clip.id:playlistSelection.ids.values().next().value||null;paintPlaylistSelection();}};
 return true;
}
function playlistCloneDrag(event,element,clip){
 event.preventDefault();event.stopPropagation();activePlaylistCancel?.();activePianoCancel?.();activeRackCancel?.();
 if(!playlistEditable()){engine.interacting=false;return false;}
 const current=project,selected=playlistSelection.has(clip.id),sourceIds=selected?[...playlistSelection.ids]:[clip.id],sourceClips=clone(allClips().filter(item=>sourceIds.includes(item.id))),sourceScope=fileImportScope(),scope=JSON.stringify(sourceScope),scale=barWidth,laneHeight=playlistLaneHeight,rowHeight=element.closest('.track-lane')?.getBoundingClientRect().height||playlistLaneHeight,snapMode=$('#snap').value,gridSnap=Number(snapMode),currentTool=tool,editVersion=audioRangeRevision,laneIds=JSON.stringify(project.cloud?.timelineLaneIds||[]),bpm=project.bpm,maxTrack=$$('.track-lane').length-1,patterns=JSON.stringify(project.patterns.filter(pattern=>sourceClips.some(item=>item.patternId===pattern.id))),viewport=$('#arrangement-scroll'),scroll={left:viewport.scrollLeft,top:viewport.scrollTop},origin={clientX:event.clientX,clientY:event.clientY,pointerId:event.pointerId},sourceState=JSON.stringify(sourceClips);
 const valid=()=>project===current&&scope===JSON.stringify(fileImportScope())&&sourceState===JSON.stringify(allClips().filter(item=>sourceIds.includes(item.id)))&&patterns===JSON.stringify(project.patterns.filter(pattern=>sourceClips.some(item=>item.patternId===pattern.id)))&&laneIds===JSON.stringify(project.cloud?.timelineLaneIds||[])&&project.bpm===bpm&&audioRangeRevision===editVersion&&barWidth===scale&&playlistLaneHeight===laneHeight&&$('#snap').value===snapMode&&tool===currentTool&&engine.ready&&!engine.loading&&!engine.editBlocked&&!workspaceBusy()&&!rangeBusy()&&!sliceBusy()&&!cloudLibrary?.writeBusy;
 const originals=new Map($$('#playlist .clip[data-clip]').map(node=>[node.dataset.clip,{node,selected:node.classList.contains('selected')}])),markers=new Map(),host=$('#arrangement'),rulerHeight=$('#timeline-ruler').getBoundingClientRect().height||24;
 if(!sourceClips.length||sourceClips.some(source=>!originals.has(source.id))){engine.interacting=false;toast('Reload the selected Playlist clips before cloning.');return false;}
 for(const source of sourceClips){const original=originals.get(source.id),marker=original.node.cloneNode(true);marker.removeAttribute('data-clip');marker.dataset.previewClip=uid();marker.dataset.sourceClip=source.id;marker.classList.add('playlist-clone-preview');marker.classList.toggle('selected',selected);marker.setAttribute('aria-hidden','true');marker.style.cssText+=`;left:${PLAYLIST_GUTTER+source.start*scale/4}px;top:${rulerHeight+playlistLayout.rowTop(source.track,rowHeight)+2}px;width:${source.length*scale/4}px;height:${rowHeight-5}px;bottom:auto;pointer-events:none;opacity:.8;z-index:11`;for(const button of marker.querySelectorAll('button')){button.disabled=true;button.tabIndex=-1;}host.append(marker);markers.set(source.id,marker);}
 for(const {node}of originals.values())node.classList.remove('selected');
 // Live: ⌥-copy snaps to the grid; holding ⌘ while dragging bypasses it (sampled per move/release).
 let physical=origin,finished=false,groupSample=null,groupStates=null,snapBypass=false;
 const contentPoint=sample=>({clientX:sample.clientX+viewport.scrollLeft-scroll.left,clientY:sample.clientY+viewport.scrollTop-scroll.top,pointerId:event.pointerId}),matches=sample=>sample?.pointerId==null||sample.pointerId===event.pointerId;
 const resolve=({deltaX,deltaY})=>{const snap=snapBypass?0:gridSnap;if(!groupSample||groupSample[0]!==deltaX||groupSample[1]!==deltaY||groupSample[2]!==snap){groupSample=[deltaX,deltaY,snap];groupStates=new Map(movePlaylistSelection(sourceClips,new Set(sourceIds),{deltaBeats:deltaX/scale*4,deltaTracks:playlistLayout.trackDelta(deltaY,rowHeight,origin.clientY,scroll.top),snapBeats:snap,maxTrack}).clips.map(item=>[item.id,item]));}return groupStates;};
 const painters=sourceClips.map(source=>new ClipGesturePainter({element:markers.get(source.id),initial:source,origin,pixelsPerBeat:scale/4,rowHeight,threshold:1.5,isValid:valid,compute:delta=>resolve(delta).get(source.id)}));
 const auto=new PlaylistAutoScroll({viewport,pointerId:event.pointerId,getInsets:()=>({left:PLAYLIST_GUTTER,top:rulerHeight}),isValid:valid,onScroll:()=>samplePainters()});auto.update(event,{enabled:false});
 const samplePainters=()=>{if(!valid()){finish(true);return false;}try{const point=contentPoint(physical);painters.forEach(painter=>painter.move(point));return true;}catch(error){finish(true);fail(error);return false;}};
 const finish=(cancel,sample)=>{if(finished||!matches(sample))return;finished=true;auto.destroy();const finalPoint=Number.isFinite(sample?.clientX)&&Number.isFinite(sample?.clientY)?sample:physical;let results;try{results=painters.map(painter=>painter.finish(contentPoint(finalPoint),{cancel}));}catch(error){results=painters.map(painter=>painter.finish(undefined,{cancel:true}));cancel=true;fail(error);}const ghosts=[...markers.values()];for(const {node,selected}of originals.values())node.classList.toggle('selected',selected);if(activePlaylistCancel===cancelGesture){activePlaylistCancel=null;engine.interacting=false;element.onpointermove=element.onpointerup=element.onpointercancel=element.onlostpointercapture=null;try{if(element.hasPointerCapture?.(event.pointerId))element.releasePointerCapture(event.pointerId);}catch{}}
  if(cancel||!results||results.some(result=>result.cancelled)||!valid()){for(const node of ghosts)node.remove();return;}const deltaBeats=results[0].state.start-sourceClips[0].start,deltaTracks=results[0].state.track-sourceClips[0].track;
  // Optimistic copies stay visible (passive) until Freestyle confirms them;
  // a rejected clone removes them and reports the error.
  sourceClips.forEach((source,index)=>{const node=markers.get(source.id),state=results[index]?.state;node.classList.remove('playlist-clone-preview');node.classList.add('playlist-clone-pending');if(state){node.style.left=`${PLAYLIST_GUTTER+state.start*scale/4}px`;node.style.top=`${rulerHeight+playlistLayout.rowTop(state.track,rowHeight)+2}px`;}});
  Promise.resolve(playlistCloneAction({sourceIds,deltaBeats,deltaTracks,selectCreated:selected,sourceClips,sourceScope})).catch(fail).finally(()=>{for(const node of ghosts)node.remove();});
 };
 const cancelGesture=Object.assign(()=>finish(true),{pointerId:event.pointerId});activePlaylistCancel=cancelGesture;engine.interacting=true;try{element.setPointerCapture?.(event.pointerId);}catch{}
 element.onpointermove=sample=>{if(!matches(sample)||!Number.isFinite(sample?.clientX)||!Number.isFinite(sample?.clientY))return;snapBypass=!!(sample.metaKey||sample.ctrlKey);physical={clientX:sample.clientX,clientY:sample.clientY,pointerId:event.pointerId};if(samplePainters())auto.update(sample,{enabled:painters.some(painter=>painter.moved)});};element.onpointerup=sample=>{if(!finished&&matches(sample)&&Number.isFinite(sample?.clientX))snapBypass=!!(sample.metaKey||sample.ctrlKey);finish(false,sample);};element.onpointercancel=element.onlostpointercapture=sample=>finish(true,sample);return true;
}
// Bounded interaction evidence only: counters and the last reason/target, no
// clip/project identities, source data, URLs, receipts or restore credentials.
const clipGestureDiagnostics={press:0,started:0,moves:0,release:0,cancel:0,lostCapture:0,nativeDragBlocked:0,queued:0,rejected:0,last:null,surface:null,stream:null,captureLoss:null};
function clipGestureRecord(event,detail={}){if(Object.hasOwn(clipGestureDiagnostics,event)&&typeof clipGestureDiagnostics[event]==='number')clipGestureDiagnostics[event]++;clipGestureDiagnostics.last={event,...detail};}
function clipPointerTarget(event){const target=event.target,tag=String(target?.localName||'').toLowerCase();return{area:target?.closest?.('#playlist')?'playlist':target?.closest?.('#rack')?'rack':target?.closest?.('#mixer')?'mixer':target?.closest?.('#piano')?'piano':'other',hit:target?.closest?.('.clip-menu-trigger')?'clip-menu':target?.closest?.('.clip-resize,.clip-trim-start')?'clip-edge':target?.closest?.('.clip-title')?'clip-title':target?.closest?.('.clip[data-clip]')?'clip-body':target?.closest?.('.playlist-navigator')?'navigator':target?.closest?.('.lane-grid')?'lane-grid':'other',tag:['svg','path','div','span','button','input'].includes(tag)?tag:'other',trusted:event.isTrusted===true,pointer:['mouse','touch','pen'].includes(event.pointerType)?event.pointerType:'unknown'};}
function clipGestureDiagnosticLines(){const d=clipGestureDiagnostics,last=d.last;return[`Playlist gesture gates: ready ${engine.ready}, loading ${!!engine.loading}, applying ${!!engine.applying}, interacting ${!!engine.interacting}, windows dragging ${!!windows.dragging} · CSS cloud-pending ${document.body.classList.contains('cloud-pending')}, cloud-library-writing ${document.body.classList.contains('cloud-library-writing')}, atomic-slice-pending ${document.body.classList.contains('atomic-slice-pending')}`,`Playlist clip gestures: presses ${d.press}, started ${d.started}, moves ${d.moves}, releases ${d.release}, cancel ${d.cancel}, lost ${d.lostCapture}, native drag blocked ${d.nativeDragBlocked}, queued ${d.queued}, rejected ${d.rejected}`,`Playlist pointer target: ${d.surface?`${d.surface.area}/${d.surface.hit}/${d.surface.tag} · trusted ${d.surface.trusted} · ${d.surface.pointer}`:'none'}`,`Playlist clip last: ${last?`${last.event} · ${last.kind||'—'} · ${last.reason||'—'} · default prevented ${last.prevented??'—'} · delta ${last.dx??0},${last.dy??0}`:'none'}`,`Playlist pointer stream: ${d.stream?`${d.stream.type} · pointer ${d.stream.pointerId??'—'}/${d.stream.expected??'—'} · buttons ${d.stream.buttons??'—'} · delta ${d.stream.dx??0},${d.stream.dy??0} · ${d.stream.target.area}/${d.stream.target.hit}/${d.stream.target.tag}`:'none'}`,`Playlist capture loss: ${d.captureLoss?`pointer ${d.captureLoss.pointerId??'—'}/${d.captureLoss.expected??'—'} · buttons ${d.captureLoss.buttons??'—'} · own target ${d.captureLoss.owned} · connected ${d.captureLoss.connected} · has capture ${d.captureLoss.captured} · ${d.captureLoss.target.area}/${d.captureLoss.target.hit}/${d.captureLoss.target.tag}`:'none'}`];}
const PLAYLIST_NO_TRIM_TOOLS=new Set(['zoom','playback','mute','erase','slice']);
/** FL ~8 px edge zones decide trim vs move from geometry, not a thin handle element. */
function clipEdgeAt(event,el){if(event.target?.closest?.('.clip-menu-trigger'))return null;const rect=el.getBoundingClientRect(),geometric=playlistTrimEdge({clientX:event.clientX,left:rect.left,right:rect.right}),handle=event.target?.classList?.contains('clip-trim-start')?'start':event.target?.classList?.contains('clip-resize')?'end':null;
 /* QA r8: on a narrow clip the 8 px trim/resize handles cover its middle; the clamped zones (≤ a third each) decide there, so the middle moves it. */
 if(handle)return rect.width>0&&rect.width<3*8?geometric:handle;return geometric;}
function clipDrag(e,el){
 clipGestureRecord('press',{kind:el.dataset.audio?'audio':'pattern',reason:'tool-'+tool,prevented:e.defaultPrevented});
 if(e.isPrimary===false)return;
 if(playlistZoomRequest(e))return playlistZoom(e,el);if(logicShellHooks.isContextClick?.(e))return;if(tool==='playback'){if(e.button===0)return playlistPlayback(e,el);if(e.button===2){e.preventDefault();e.stopPropagation();return;}}if(tool==='mute'&&e.button===0){if(e.ctrlKey||e.metaKey)return marqueePlaylist(e,el);return playlistMuteStroke(e,el);}
 // Logic: the right button opens the region menu (contextmenu); erasing is the Eraser tool or Delete.
 if(e.button===2)return;
 if(e.button!==0)return;activePlaylistCancel?.();e.stopPropagation();if(!playlistEditable()){clipGestureRecord('rejected',{reason:'editability'});return;}const c=findClip(el.dataset.clip);if(!c){clipGestureRecord('rejected',{reason:'missing-clip'});return;}
 // The beat is not an editable clip here (no move/trim/split through Studio API); select it with Ctrl/Cmd-click.
 if(c.cloudRaw?.isBacking===true&&!(e.ctrlKey||e.metaKey)){clipGestureRecord('rejected',{reason:'backing-not-editable'});toast(BACKING_NOT_EDITABLE);return;}
 const edge=clipEdgeAt(e,el);
 if((e.ctrlKey||e.metaKey)&&!edge)return playlistClipSelect(e,el,c);
 if(tool==='erase')return startPlaylistStroke(e,el,'erase');
 if(tool==='slice'){
  const beat=c.start+quantize((e.clientX-el.getBoundingClientRect().left)/barWidth*4);if(beat<=c.start||beat>=c.start+c.length)return;
  return splitClipOptimistic(c,beat).catch(fail);
 }
 // Live: the grid applies to move/copy/trim/slip; holding ⌘ WHILE dragging bypasses it (⌘ at press is
 // ⌘-click select). Read per sample from the move/release event, never latched from ⌥ at press.
 const gridSnap=+$('#snap').value;let snapBypass=false;const gestureSnap=()=>snapBypass?0:gridSnap;
 // Live: ⇧⌥-drag inside a clip slips its contents (Arrangement); it never also copies.
 const liveSlip=e.shiftKey&&e.altKey&&!e.ctrlKey&&!e.metaKey&&!edge;
 const trimmingStart=edge==='start',resizing=!!edge,slipping=(tool==='slip'||liveSlip)&&!resizing;
 // Live: ⌥-drag copies clips (Shift-drag clone kept from the FL layer).
 if((e.altKey||e.shiftKey)&&!e.ctrlKey&&!e.metaKey&&!resizing&&!slipping)return playlistCloneDrag(e,el,c);
 // Own the accepted gesture, as Draw/clone already do. Browser-native drag
 // defaults can cancel pointer delivery before our release-only commit.
 e.preventDefault();
 if(!playlistSelection.has(c.id))playlistSelection.select([c.id]);selectedClip=c.id;paintPlaylistSelection();
 const current=project,version=engine.loadVersion,startX=e.clientX,startY=e.clientY,old={...c},rowHeight=el.closest('.track-lane')?.getBoundingClientRect().height||playlistLaneHeight,maxTrack=$$('.track-lane').length-1,initial=allClips(),selected=playlistSelection.ids;
 const context={projectId:engine.projectId,trackId:engine.session.trackId,version:engine.session.contextVersion||0,edit:audioRangeRevision},invalidReason=()=>project!==current?'project-replaced':engine.loadVersion!==version?'load-changed':engine.projectId!==context.projectId?'project-changed':engine.session.trackId!==context.trackId?'take-changed':(engine.session.contextVersion||0)!==context.version?'context-changed':audioRangeRevision!==context.edit?'edit-revision-changed':!engine.ready?'not-ready':engine.loading?'loading':engine.editBlocked?'applying':workspaceBusy()&&!importEditGate()?'workspace-busy':rangeBusy()?'range-busy':sliceBusy()?'slice-busy':cloudLibrary?.writeBusy?'library-busy':null,valid=()=>!invalidReason();
 const group=resizing&&!trimmingStart?[c]:initial.filter(clip=>selected.has(clip.id));engine.interacting=true;try{el.setPointerCapture(e.pointerId);}catch{engine.interacting=false;clipGestureRecord('rejected',{reason:'capture-failed'});return;}const gestureKind=slipping?'slip':trimmingStart?'start-trim':resizing?'end-trim':'move';clipGestureRecord('started',{kind:gestureKind,reason:'captured',prevented:e.defaultPrevented});
 const viewport=$('#arrangement-scroll'),initialScroll={left:viewport.scrollLeft,top:viewport.scrollTop};let physicalPoint={clientX:startX,clientY:startY,pointerId:e.pointerId};const contentSample=event=>({...event,clientX:event.clientX+viewport.scrollLeft-initialScroll.left,clientY:event.clientY+viewport.scrollTop-initialScroll.top,pointerId:e.pointerId});
 let groupSample=null,groupStates=null;const resolveGroup=({deltaX,deltaY})=>{const snap=gestureSnap(),key=[deltaX,trimmingStart||slipping?0:deltaY,barWidth,snap];if(!groupSample||key.some((value,index)=>value!==groupSample[index])){
  let states;
  if(trimmingStart){const requested=snap>0?Math.round(deltaX/barWidth*4/snap)*snap:deltaX/barWidth*4,trim=(clip,delta)=>trimPlaylistClipStart(clip,{deltaBeats:delta,snapBeats:0,bpm:current.bpm,/* QA r6: never 1 ms — one grid step, 1/16 with snap off */minLengthBeats:playlistTrimMinimumBeats(snap),pattern:current.patterns.find(pattern=>pattern.id===clip.patternId)}),candidates=group.map(clip=>trim(clip,requested)),deltas=candidates.map((clip,index)=>clip.start-group[index].start),shared=requested>=0?Math.min(requested,...deltas):Math.max(requested,...deltas);states=group.map(clip=>trim(clip,shared));}
  else if(slipping){const requested=snap>0?Math.round(deltaX/barWidth*4/snap)*snap:deltaX/barWidth*4,slip=(clip,delta)=>slipPlaylistClipContents(clip,{deltaBeats:delta,snapBeats:0,bpm:current.bpm,pattern:current.patterns.find(pattern=>pattern.id===clip.patternId)}),candidates=group.map(clip=>slip(clip,requested)),audioDeltas=candidates.flatMap((clip,index)=>clip.patternId?[]:[group[index].offset-clip.offset]),shared=requested>=0?Math.min(requested,...audioDeltas):Math.max(requested,...audioDeltas);states=group.map(clip=>slip(clip,shared));}
  else states=movePlaylistSelection(initial,selected,{deltaBeats:deltaX/barWidth*4,deltaTracks:playlistLayout.trackDelta(deltaY,rowHeight,startY,initialScroll.top),snapBeats:snap,maxTrack}).clips;
  // Resolve and validate the whole group before publishing preview or commit.
  const resolved=new Map(states.map(clip=>[clip.id,clip]));groupStates=resolved;groupSample=key;
 }return groupStates;};
 const clipElements=new Map($$('#playlist .clip[data-clip]').map(node=>[node.dataset.clip,node]));
 const painters=group.map(clip=>{const element=clipElements.get(clip.id),svg=element.querySelector(clip.patternId?'.pattern-preview-svg':'[data-cloud-waveform]'),originalMarkup=svg?.outerHTML,originalTransform=svg?.style.transform||'';return new ClipGesturePainter({element,initial:clip,origin:{clientX:startX,clientY:startY,pointerId:e.pointerId},pixelsPerBeat:barWidth/4,rowHeight,resize:resizing,resizeStart:trimmingStart,slip:slipping,paintSlip:next=>{if(!clip.patternId&&ablWaveforms){element.dataset.waveOffset=String(next.offset);return;}const target=element.querySelector(clip.patternId?'.pattern-preview-svg':'[data-cloud-waveform]');if(!target)return;if(clip.patternId){const markup=patternSvg(current.patterns.find(pattern=>pattern.id===clip.patternId),'#2d4844',next);if(target.outerHTML!==markup)target.outerHTML=markup;}else target.style.transform=`translateX(${(clip.offset-next.offset)*barWidth/4}px)`;},restoreSlip:()=>{if(!clip.patternId)delete element.dataset.waveOffset;const target=element.querySelector(clip.patternId?'.pattern-preview-svg':'[data-cloud-waveform]');if(!target)return;if(clip.patternId&&originalMarkup)target.outerHTML=originalMarkup;else target.style.transform=originalTransform;},threshold:1.5,isValid:valid,compute:delta=>resizing&&!trimmingStart?computePlaylistGesture(old,{deltaBeats:delta.deltaX/barWidth*4,deltaTracks:0,snapBeats:gestureSnap(),resize:true,maxTrack,bpm:current.bpm}):resolveGroup(delta).get(clip.id)});});
 const samplePainters=()=>{const sample=contentSample(physicalPoint);try{if((trimmingStart||slipping)&&(painters.some(painter=>painter.moved)||Math.hypot(sample.clientX-startX,sample.clientY-startY)>=1.5))resolveGroup({deltaX:sample.clientX-startX,deltaY:0});painters.forEach(painter=>painter.move(sample));return true;}catch(error){finish(true);fail(error);return false;}};
 const autoscroll=new PlaylistAutoScroll({viewport,pointerId:e.pointerId,getInsets:()=>({left:PLAYLIST_GUTTER,top:$('#timeline-ruler').getBoundingClientRect().height||24}),isValid:valid,onScroll:samplePainters});autoscroll.update(e,{enabled:false});
 const recordStream=event=>{clipGestureDiagnostics.stream={type:event.type||'unknown',pointerId:Number.isInteger(event.pointerId)?event.pointerId:null,expected:e.pointerId,buttons:Number.isInteger(event.buttons)?event.buttons:null,dx:Number.isFinite(event.clientX)?Math.round(event.clientX-startX):null,dy:Number.isFinite(event.clientY)?Math.round(event.clientY-startY):null,target:clipPointerTarget(event)};};
 const movePointer=event=>{recordStream(event);if(event.pointerId!=null&&event.pointerId!==e.pointerId||!Number.isFinite(event.clientX)||!Number.isFinite(event.clientY))return;snapBypass=!!(event.metaKey||event.ctrlKey);physicalPoint={clientX:event.clientX,clientY:event.clientY,pointerId:e.pointerId};clipGestureRecord('moves',{kind:gestureKind,reason:invalidReason()||'sample',dx:Math.round(event.clientX-startX),dy:Math.round(event.clientY-startY)});if(samplePainters())autoscroll.update(event,{enabled:painters.some(painter=>painter.moved)});};
 let finished=false;const finish=(cancel,event,reason=cancel?'cancel-request':'release')=>{if(finished||event?.pointerId!=null&&event.pointerId!==e.pointerId)return;finished=true;const invalid=invalidReason();clipGestureRecord(cancel?'cancel':'release',{kind:gestureKind,reason:invalid||reason,dx:Number.isFinite(event?.clientX)?Math.round(event.clientX-startX):0,dy:Number.isFinite(event?.clientY)?Math.round(event.clientY-startY):0});autoscroll.destroy();activePlaylistCancel=null;document.removeEventListener('pointermove',movePointer,true);document.removeEventListener('pointerup',releasePointer,true);document.removeEventListener('pointercancel',cancelPointer,true);el.onlostpointercapture=null;try{if(el.hasPointerCapture?.(e.pointerId))el.releasePointerCapture(e.pointerId);}catch{}const finalSample=Number.isFinite(event?.clientX)&&Number.isFinite(event?.clientY)?contentSample(event):contentSample(physicalPoint);let results;try{if(!cancel&&(trimmingStart||slipping)&&(painters.some(painter=>painter.moved)||Math.hypot(finalSample.clientX-startX,finalSample.clientY-startY)>=1.5))resolveGroup({deltaX:finalSample.clientX-startX,deltaY:0});results=painters.map(painter=>painter.finish(finalSample,{cancel}));}catch(error){results=painters.map(painter=>painter.finish(undefined,{cancel:true}));cancel=true;fail(error);}engine.interacting=false;if(project!==current||engine.loadVersion!==version)return;if(cancel||results.some(result=>result.cancelled)){clipGestureRecord('rejected',{kind:gestureKind,reason:invalid||reason});renderPlaylist();return;}if(results.some(result=>result.changed)){
  if(results.length===1&&findClip(results[0].state.id)?.patternId&&findClip(results[0].state.id)?.cloudId&&results[0].state.track!==findClip(results[0].state.id).track&&(project.cloud?.timelineLaneIds||[]).length>0&&!project.cloud.timelineLaneIds[results[0].state.track]&&engine.session.rawState?.studioApi===true){clipGestureRecord('queued',{kind:gestureKind,reason:'new-lane-move'});renderPlaylist();movePatternToNewRow(findClip(results[0].state.id),results[0].state).catch(fail);return;}
  if(results.some(result=>{const original=findClip(result.state.id),rows=project.cloud?.timelineLaneIds||[];return result.state.track!==original.track&&!rows[result.state.track]&&(!original.patternId||rows.length>0);})){const audio=results.some(result=>!findClip(result.state.id).patternId);clipGestureRecord('rejected',{kind:gestureKind,reason:'destination-lane'});clientLog('playlist-move-rejected',{reason:'lane_less_row',rows:results.map(result=>result.state.track)});renderPlaylist();toast(audio?'Choose existing cloud lanes for every selected audio clip.':'That Playlist row has no Freestyle track yet. Add a track there first (Add Track), then move the clip.');return;}
  // Logic/FL: during a file import the move paints now and its save queues behind the import, re-applied by id onto the project the import returns.
  if(importEditGate()){const states=results.map(result=>({...result.state}));const apply=()=>{for(const state of states){const target=findClip(state.id);if(target)Object.assign(target,state);}};apply();renderPlaylist();queueBehindImport(gestureKind==='move'?'Move':'Resize',()=>{if(!states.every(state=>findClip(state.id)))return toast('A queued region edit was skipped: the region changed during the import.');apply();changed();});clipGestureRecord('queued',{kind:gestureKind,reason:'behind-file-import'});return;}
  for(const result of results)Object.assign(findClip(result.state.id),result.state);changed();clipGestureRecord('queued',{kind:gestureKind,reason:'edit-queued'});
 }else clipGestureRecord('rejected',{kind:gestureKind,reason:painters.some(painter=>painter.moved)?'snap-or-return':'no-motion'});};
 // Keep delivery owned by this gesture even if the browser retargets a move
 // or release outside the clip. Capture still provides normal browser routing;
 // these exact-pointer listeners also share the navigator's document lifecycle.
 const releasePointer=event=>{recordStream(event);if(!finished&&(event.pointerId==null||event.pointerId===e.pointerId)&&Number.isFinite(event.clientX))snapBypass=!!(event.metaKey||event.ctrlKey);finish(false,event);},cancelPointer=event=>{recordStream(event);finish(true,event,'pointercancel');};
 activePlaylistCancel=Object.assign(()=>finish(true),{pointerId:e.pointerId});document.addEventListener('pointermove',movePointer,true);document.addEventListener('pointerup',releasePointer,true);document.addEventListener('pointercancel',cancelPointer,true);el.onlostpointercapture=event=>{if(event?.pointerId!=null&&event.pointerId!==e.pointerId)return;clipGestureDiagnostics.captureLoss={pointerId:Number.isInteger(event?.pointerId)?event.pointerId:null,expected:e.pointerId,buttons:Number.isInteger(event?.buttons)?event.buttons:null,owned:!event?.target||event.target===el,connected:el.isConnected,captured:!!el.hasPointerCapture?.(e.pointerId),target:clipPointerTarget(event||{})};if(event?.target&&event.target!==el)return;clipGestureDiagnostics.lostCapture++;finish(true,event,'lostpointercapture');};
}
function makeUnique(id){edit(()=>{const c=project.clips.find(c=>c.id===id),p=clone(project.patterns.find(p=>p.id===c.patternId));p.id=uid();p.name+=' #2';project.patterns.push(p);c.patternId=p.id;project.selectedPattern=p.id;});}
function currentMixerModel(){const scope=JSON.stringify(mixerScope());if(mixerModelCache?.project===project&&mixerModelCache.epoch===mixerModelEpoch&&mixerModelCache.scope===scope)return mixerModelCache.model;const state=mixerState?.snapshot(),live=mixerLive?.snapshot();let current=project;
 // Fence controller reads to the exact accepted raw state; later canonical accepts win.
 if(live&&mixerLiveRawState===project.cloud?.rawState&&JSON.stringify(live.scope)===JSON.stringify(state?.scope))current={...project,cloud:{...project.cloud,rawState:{...project.cloud.rawState,buses:live.liveReadStatus==='ready'&&live.liveBuses?{ok:true,buses:live.liveBuses}:undefined}}};
 const savedBuses=project.cloud?.rawState?.studioApi===true?project.cloud.rawState.persistedBuses??(project.cloud.rawState.buses?.live!==true?project.cloud.rawState.buses?.buses:undefined):state?.buses;const model=buildMixerModel({project:current,persistedBuses:savedBuses??undefined,persistedBusProjectId:project.cloud?.rawState?.studioApi===true?engine.projectId:state?.scope?.projectId,liveMix:shownLiveMix?.projectId===engine.projectId?shownLiveMix.mix:null}),master=mixerMaster?.snapshot(),masterRow=model.rows.find(row=>row.kind==='bus'&&row.id==='master');if(masterRow&&master?.readStatus==='ready'&&mixerMasterRawState===project.cloud?.rawState){const saved=master.savedGain,live=master.liveGain;masterRow.values.gain={known:live.known,value:live.value,origin:'runtime',unit:'linear-gain',persisted:{...saved,field:'masterGain'},runtime:{...live,field:'gain'},mismatch:saved.known&&live.known?!sameMixerValue(saved.value,live.value):null,readUnknown:!live.known};masterRow.controls.gain={supported:true,enabled:live.known&&saved.known,target:{kind:'bus',busId:'master'},reason:null};}const pan=mixerPan?.snapshot();if(pan?.readStatus==='ready'&&mixerPanRawState===project.cloud?.rawState){for(const row of model.rows){if(row.kind!=='lane')continue;const lane=pan.values[row.id];if(!lane)continue;row.values.pan={known:lane.livePan.known,value:lane.livePan.value,origin:'runtime',unit:'signed-pan',persisted:{...lane.savedPan,field:'pan'},runtime:{...lane.livePan,field:'pan'},mismatch:lane.savedPan.known&&lane.livePan.known?!sameMixerValue(lane.savedPan.value,lane.livePan.value):null};row.controls.pan={supported:true,enabled:lane.eligible,target:{kind:'lane',laneId:row.id},reason:lane.reason};}}if(mixerQueue?.busy||mixerQueue?.holding)for(const row of model.rows)for(const control of ['gain','pan','mute','solo']){const pending=mixerQueue.optimistic({kind:row.kind,id:row.id},control);if(pending&&row.values?.[control])row.values[control]={...row.values[control],known:true,value:pending.value};}
 // An in-flight mixer Undo/Redo shows its value (an earlier save's re-read never releases it).
 if(mixerHistoryPending.size)for(const row of model.rows)for(const control of ['gain','pan','mute','solo']){const key=MixerControlQueue.key({kind:row.kind,id:row.id},control);if(mixerHistoryPending.has(key)&&row.values?.[control])row.values[control]={...row.values[control],known:true,value:mixerHistoryPending.get(key)};}
 mixerModelCache={project,epoch:mixerModelEpoch,scope,model};return model;}
function currentMixerRow(){const rows=currentMixerModel().rows;return rows.find(row=>row.key===selectedMixerKey)||rows.find(row=>row.kind==='bus'&&row.id==='master')||rows[0]||null;}
function mixerRowChannel(row){if(!row)return null;const master=row.kind==='bus'&&row.id==='master',slots=row.plugins.slots,plugins=slots.map(slot=>{const verified=!!slot.binding||master&&row.runtime.status==='bound'&&slot.origin==='runtime'&&Number.isInteger(slot.index)&&slot.index>=0&&slots.filter(other=>other.index===slot.index).length===1;return {...slot.raw,index:verified?slot.index:null,plugin_index:verified?slot.index:null};});return {id:row.id,kind:row.kind,name:row.name,...row.kind==='lane'?{laneId:row.id}:{busId:row.id},plugins};}
function mixerEditableChannel(row,control){const model=currentMixerModel(),actual=model.rows.find(item=>item.key===row.key);if(!actual?.controls[control]?.enabled||actual.kind!=='lane')throw new Error('Reload this mixer lane before changing its level.');const matches=project.channels.filter(channel=>!channel.patternSource&&channel.laneId===actual.id);if(matches.length!==1)throw new Error('The lane has no unique current mixer control.');return matches[0];}
let mixerInspection={key:null,attempts:new Map()},mixerInspectionQueued=false,mixerInspectionError=null,mixerRenderPending=false;
const mixerInspectionKey=()=>JSON.stringify([engine.projectId,engine.session.trackId,engine.loadVersion||0,engine.session.contextVersion||0]);
async function inspectMixerValues({force=false}={}){
 if(restMixer?.isRestMode){mixerInspectionError=null;if(force){const receipt=restMixer.snapshot().receipt;if(receipt)await restMixer.inspect(receipt.target,receipt.control);renderMixer();}return;}
 const key=mixerInspectionKey(),rawState=project.cloud?.rawState;if(mixerInspection.key!==key)mixerInspection={key,attempts:new Map()};const inspection=mixerInspection;
 const definitions=[['bus',mixerLive,mixerLiveRawState,'liveReadStatus'],['master',mixerMaster,mixerMasterRawState,'readStatus'],['pan',mixerPan,mixerPanRawState,'readStatus']],jobs=[];
 for(const [name,controller,boundRaw,status]of definitions){const previous=inspection.attempts.get(name);if(!force&&(controller.busy||controller.snapshot()[status]==='ready'&&boundRaw===rawState||previous?.failed||previous?.rawState===rawState))continue;
  const attempt={rawState,failed:false};inspection.attempts.set(name,attempt);jobs.push(Promise.resolve().then(()=>{if(mixerInspectionKey()!==key||project.cloud?.rawState!==rawState)return;return controller.inspect();}).catch(error=>{attempt.failed=true;throw error;}));
 }
 if(!jobs.length)return;const results=await Promise.allSettled(jobs);if(mixerInspection!==inspection||mixerInspectionKey()!==key)return;
 mixerInspectionError=results.some(result=>result.status==='rejected')?{key,message:'Some mixer values could not be loaded. Use ↻ to retry.'}:null;renderMixerStatus();
 if(force){const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;}
}
function requestMixerInspection(){
 if(mixerInspectionQueued)return;mixerInspectionQueued=true;queueMicrotask(()=>{mixerInspectionQueued=false;if(!engine.ready||!directLevelEditable()||engine.interacting||$('#mixer').classList.contains('hidden'))return;inspectMixerValues().catch(fail);});
}
async function refreshMixer(){if(!engine.ready)return openCloudPanel();if(!directLevelEditable()||engine.interacting||mixerRequestBusy())return toast('Finish the current edit before refreshing the mixer.');await engine.flush();await engine.refresh({native:true});await inspectMixerValues({force:true});renderMixer();}
async function openBusSettings(){
 if(!engine.ready)return openCloudPanel();if(!directLevelEditable()||engine.interacting)return toast('Finish the current cloud edit before opening buses.');await engine.flush();await mixerState.refresh();
 const busScope=JSON.stringify([engine.projectId,engine.session.trackId,engine.loadVersion||0,engine.session.contextVersion||0]),assertBusDialog=()=>{if(JSON.stringify([engine.projectId,engine.session.trackId,engine.loadVersion||0,engine.session.contextVersion||0])!==busScope)throw new Error('The cloud project changed. Reopen the bus settings.');};const d=dialog('Mixer buses','<p>Saved project buses. Live playback changes are not yet verified.</p><label>Bus<select class="bus-choice"></select></label><label>Name<input class="bus-name" maxlength="255"></label><label>Volume (%)<input class="bus-gain" type="number" min="0" max="400" step="1" placeholder="Not reported"></label><label><input class="bus-mute" type="checkbox"> Muted</label><label><input class="bus-solo" type="checkbox"> Solo</label><p class="bus-state" role="status"></p><button class="bus-inspect">Reload buses</button><button class="primary bus-save">Create bus</button>');
 let selected=null,newId=crypto.randomUUID(),dirtyFields=new Set(),busy=false;const recoveryBlocked=()=>{const state=mixerState.snapshot();return state.records.some(entry=>JSON.stringify(entry.scope)===JSON.stringify(state.scope)&&['uncertain','saved_unconfirmed','rejected'].includes(entry.status)&&!entry.inspectedRead);};const unlock=()=>{const master=selected==='master';for(const input of d.querySelectorAll('input'))input.disabled=master||busy;choice.disabled=busy;save.disabled=master||busy||recoveryBlocked();};const choice=d.querySelector('.bus-choice'),status=d.querySelector('.bus-state'),save=d.querySelector('.bus-save');
 const populate=()=>{const snapshot=mixerState.snapshot();choice.innerHTML='<option value="">New bus</option>'+((snapshot.buses||[]).map(bus=>`<option value="${esc(bus.id??bus.bus_id)}">${esc(bus.name||bus.id||bus.bus_id)}</option>`).join(''));choice.value=selected||'';paint();};
 const paint=()=>{const bus=mixerState.snapshot().buses?.find(bus=>(bus.id??bus.bus_id)===selected),master=selected==='master';d.querySelector('.bus-name').value=typeof bus?.name==='string'?bus.name:'';d.querySelector('.bus-gain').value=typeof bus?.gain==='number'?String(bus.gain*100):'';for(const [selector,key]of [['.bus-mute','muted'],['.bus-solo','soloed']]){const input=d.querySelector(selector);input.checked=bus?.[key]===true;input.indeterminate=!!selected&&typeof bus?.[key]!=='boolean';}dirtyFields.clear();save.textContent=selected?'Save bus':'Create bus';save.disabled=master||busy||recoveryBlocked();for(const input of d.querySelectorAll('input'))input.disabled=master||busy;status.textContent=master?'The master bus is read-only.':'';};
 choice.onchange=()=>{selected=choice.value||null;paint();};for(const [selector,key]of [['.bus-name','name'],['.bus-gain','gain'],['.bus-mute','muted'],['.bus-solo','soloed']])d.querySelector(selector).oninput=()=>dirtyFields.add(key);
 d.querySelector('.bus-inspect').onclick=async()=>{try{assertBusDialog();busy=true;save.disabled=true;await mixerState.refresh();populate();status.textContent='Saved buses reloaded.';}catch(error){status.textContent=error.message;}finally{busy=false;unlock();}};
 save.onclick=async()=>{if(busy)return;try{assertBusDialog();assertRangeIdle();if(recoveryBlocked())throw new Error('Reload the saved buses to inspect the previous result before another edit.');}catch(error){status.textContent=error.message;return;}busy=true;save.disabled=true;choice.disabled=true;const request={bus_id:selected||newId};for(const field of dirtyFields){if(field==='name')request.name=d.querySelector('.bus-name').value;if(field==='gain'){const value=d.querySelector('.bus-gain').value;if(value===''){status.textContent='Enter a volume before saving it.';busy=false;save.disabled=false;choice.disabled=false;return;}request.gain=Number(value)/100;}if(field==='muted')request.muted=d.querySelector('.bus-mute').checked;if(field==='soloed')request.soloed=d.querySelector('.bus-solo').checked;}
  try{await mixerState[selected?'updateBus':'createBus'](request);selected=request.bus_id;selectedMixerKey=mixerRowKey('bus',selected);mixerChannel=selected;newId=crypto.randomUUID();populate();renderMixer();status.textContent='Bus settings saved. Live playback has not been confirmed.';}catch(error){status.textContent=error.message;}finally{busy=false;unlock();}
 };populate();return d;
}
function mixerScope(){return {project:engine.projectId,track:engine.session.trackId,load:engine.loadVersion||0,context:engine.session.contextVersion||0,revision:audioRangeRevision};}
function audioClipMuteContext(){return{projectId:engine.projectId,scope:{track:engine.session.trackId,load:engine.loadVersion||0,context:engine.session.contextVersion||0},revision:audioRangeRevision};}
function audioClipMuteValue(clipId){const overlay=audioClipMuteOverlay.get(clipId);if(overlay&&overlay.projectId===engine.projectId)return overlay.muted;const clip=(project.audioClips||[]).filter(item=>item?.id===clipId);return clip.length===1?audioClipMuted(clip[0]):null;}
function sendAudioClipMuteNow(clipId,muted){if(restMixer?.isRestMode!==true)return Promise.reject(Object.assign(new Error('Per-clip audio mute needs a Studio API (OAuth) project. Reload the project.'),{dispatched:false}));return sendAudioClipMute(restMixer.client,{projectId:engine.projectId,clipId,muted,trackId:engine.session.trackId||null});}
// After writes: canonical reload is the truth; a confirmed overlay stays only if that reload fails.
async function settleAudioClipMutes(context,confirmed,attempted){const sameScope=()=>engine.projectId===context.projectId&&JSON.stringify(audioClipMuteContext().scope)===JSON.stringify(context.scope);for(const clipId of attempted)if(!confirmed.includes(clipId))audioClipMuteOverlay.delete(clipId);let refreshError=null;if(sameScope()){try{await engine.refresh();for(const clipId of attempted)audioClipMuteOverlay.delete(clipId);}catch(error){refreshError=error;}}else for(const clipId of attempted)audioClipMuteOverlay.delete(clipId);renderPlaylist();return{refreshError,current:sameScope()};}
function audioClipMuteFailureMessage(error,name){return clipMuteRejected(error)?`Freestyle refused the mute for clip “${name}”: ${error?.message||error}`:`Freestyle did not confirm the mute for clip “${name}” (outcome unknown). It was not retried; the saved Playlist was reloaded — check the clip before trying again.`;}
async function commitAudioClipMutes(changes){
 if(!changes.length)return;if(audioClipMutes.busy)throw new Error('Wait for the current clip mute request.');
 const context=audioClipMuteContext(),confirmed=[],attempted=[];let reloadRequired=false,failure=null,failedName=null;
 for(const change of changes)audioClipMuteOverlay.set(change.clipId,{projectId:context.projectId,muted:change.muted});renderPlaylist();
 audioClipMutes.busy=true;
 try{for(const change of changes){if(engine.projectId!==context.projectId||JSON.stringify(audioClipMuteContext().scope)!==JSON.stringify(context.scope)){failure=Object.assign(new Error('The project changed before every clip mute was sent.'),{dispatched:false});failedName=change.name;break;}attempted.push(change.clipId);try{const receipt=await sendAudioClipMuteNow(change.clipId,change.muted);confirmed.push({...change,after:change.muted,undoMuted:receipt.undo.muted});reloadRequired||=receipt.reloadRequired;}catch(error){failure=error;failedName=change.name;break;}}}
 finally{audioClipMutes.busy=false;}
 for(const change of changes)if(!attempted.includes(change.clipId))audioClipMuteOverlay.delete(change.clipId);
 const {refreshError,current}=await settleAudioClipMutes(context,confirmed.map(change=>change.clipId),attempted);
 if(confirmed.length&&current){audioClipMutes.record({projectId:context.projectId,scope:context.scope,changes:confirmed,revision:++audioRangeRevision});historyNewStep('audio');}
 const messages=[];if(confirmed.length)messages.push(audioClipMuteLabel({names:confirmed.map(change=>change.name),muted:confirmed[0].after,count:confirmed.length}));if(reloadRequired)messages.push(audioClipMuteReloadMessage(confirmed.length));if(failure)messages.push(audioClipMuteFailureMessage(failure,failedName));if(refreshError)messages.push(`Saved Playlist reload failed: ${refreshError.message||refreshError}`);
 const message=messages.join(' ');$('#status-message').textContent=message;toast(message);return{confirmed,reloadRequired,failure};
}
async function audioClipMuteHistoryStep(direction){
 const context=audioClipMuteContext(),label=direction==='undo'?'Undo':'Redo';let result=null,failure=null,attempted=[];
 try{result=await audioClipMutes.step(context,direction,{send:sendAudioClipMuteNow,currentValue:audioClipMuteValue,begin:targets=>{attempted=targets.map(target=>target.clipId);for(const target of targets)audioClipMuteOverlay.set(target.clipId,{projectId:context.projectId,muted:target.muted});renderPlaylist();}});}catch(error){failure=error;}
 if(!attempted.length)throw failure;
 const confirmed=result?result.applied:failure.applied||[],{refreshError}=await settleAudioClipMutes(context,confirmed,attempted);
 const entry=audioClipMutes.entries.at(-1);if(entry&&result)entry.revision=++audioRangeRevision;
 const messages=[];if(result){const value=direction==='undo'?entry.changes[0].before:entry.changes[0].after;messages.push(`${label}: ${audioClipMuteLabel({names:entry.changes.map(change=>change.name),muted:value,count:entry.changes.length})}`);if(result.reloadRequired)messages.push(audioClipMuteReloadMessage(entry.changes.length));}else messages.push(`${label}: ${audioClipMuteFailureMessage(failure,entry?.changes.find(change=>!confirmed.includes(change.clipId))?.name||'audio clip')}`);if(refreshError)messages.push(`Saved Playlist reload failed: ${refreshError.message||refreshError}`);
 const message=messages.join(' ');$('#status-message').textContent=message;toast(message);
}
// Studio Pro's realtime path: lane gain/mute/solo go straight over the ordered
// mozart-control channel (durable lane_id, track_id:-1) for immediate sound;
// the typed REST write below remains the persisted, confirmed step. Pro has no
// data-channel contract for pan, master or bus controls, so they stay REST-only.
function liveMixerMessage(row,control,value){if(row?.kind!=='lane')return null;return control==='gain'?liveLaneGainMessage(row.id,value):liveLaneToggleMessage(row.id,control,value);}
// Realtime sends move the live mix revision too: remember them as ours so the
// long-poll does not repaint them as someone else's change.
function noteLiveMixerSend(row,control,message){if(message)mixRevision?.noteOwn({kind:row.kind,id:row.id},control,control==='gain'?message.gain:control==='mute'?message.muted:message.soloed,{realtime:true});}
function liveMixerLevel({row,value,scope}){
 if(JSON.stringify(scope)!==JSON.stringify(mixerScope())||!mixerControlEditable())return false;
 const actual=currentMixerModel().rows.find(item=>item.key===row?.key),message=actual?.controls?.gain?.enabled?liveMixerMessage(actual,'gain',value):null;
 const sent=!!message&&['sent','queued'].includes(engine.liveControl?.set(message));if(sent)noteLiveMixerSend(actual,'gain',message);return sent;
}
// Audible while dragging, for every gain and pan control. Lane gain has a realtime
// mozart-control message (above). Lane pan, bus gain/pan and master gain/pan have none, so
// their drags use the Studio API's documented live sweep (the same PUT with persist:false;
// live-mix-sweep.js): one request in flight per control, latest value wins. Nothing here is
// saved or enters Undo: the release is the one persisted write (mixerControl).
let liveMixGestures=0;
const liveMixSweep=new LiveMixSweep({
 send:request=>{const expected=mixRevision?.revision??null,change={target:request.target,control:request.control,value:request.value};mixRevision?.noteOwn(change.target,change.control,change.value);
  return restMixer.client.call(request.operationId,{path:request.path,body:request.body},{idempotencyKey:globalThis.crypto.randomUUID()}).then(result=>{mixRevision?.noteWrite?.(result,[change],{expected});return result;});},
 onSent:request=>clientLog('mixer-live-sweep',{control:request.control,kind:request.target.kind,id:request.target.id,value:request.value,operationId:request.operationId}),
 onError:(error,request)=>clientLog('mixer-live-sweep-failed',{control:request.control,kind:request.target.kind,id:request.target.id,operationId:request.operationId,status:error?.status??null,code:error?.code??null,error:String(error?.message||error).slice(0,160)})});
function liveMixerControl({row,value,scope},control='gain'){
 if(control==='gain'&&liveMixerLevel({row,value,scope}))return true;
 if(!['gain','pan'].includes(control)||!restMixer?.isRestMode||JSON.stringify(scope)!==JSON.stringify(mixerScope())||!mixerControlEditable())return false;
 const actual=currentMixerModel().rows.find(item=>item.key===row?.key);if(!actual?.controls?.[control]?.enabled)return false;
 const target={kind:actual.kind,id:actual.id},request=liveMixSweepRequest(engine.projectId,target,control,value);
 return !!request&&liveMixSweep.set(liveMixSweepKey(target,control),request)!==false;
}
/** A control outside the Mixer strips (track header) is being dragged: hold the live-mix repaint so the
 * model keeps the pre-drag value until the release is committed. */
function liveMixGesture(active){liveMixGestures=Math.max(0,liveMixGestures+(active?1:-1));}
/** Track-header drag: the lane's gain or pan, heard now (never saved). */
function liveTrackMixerControl(row,control,value){const target=playlistTrackMixerRow(project.cloud?.timelineLaneIds?.[row]);if(!target?.controls?.[control]?.enabled)return false;return liveMixerControl({row:target,value,scope:mixerScope()},control);}
function sendLiveMixerFinal(row,control,value){const message=liveMixerMessage(row,control,value),live=engine.liveControl;if(!message||!live)return false;const result=live.set(message),sent=result==='queued'?live.flush(liveControlKey(message))==='sent':result==='sent';if(sent)noteLiveMixerSend(row,control,message);return sent;}
// FL: every completed Mixer gesture (one drag, one click) is one Undo step,
// ordered with Playlist/pattern steps. The inverse writes the previous saved
// value through the same saved route, only if the saved value is still this
// gesture's result (If-Match is read fresh by the mixer for every write).
const MIXER_HISTORY_CONTROLS=new Set(['gain','pan','mute','solo']);
// Engine gains read back as float32 (0.4 → 0.4000000059604645).
function sameMixerValue(a,b){return mixValuesEqual(a,b);}
/** Freestyle echoes a lane mute/solo onto that lane's pattern placements
 * (placement muted/soloed): the history step declares that echo for each
 * direction so the observer does not take it for an outside edit. */
function mixerCascade(changes){
 const field={mute:'muted',solo:'soloed'},items=(changes||[]).filter(change=>change?.target?.kind==='lane'&&field[change.control]&&typeof change.value==='boolean');
 return items.length?{after:items.map(change=>({laneId:change.target.id,field:field[change.control],value:change.value})),before:items.filter(change=>typeof change.before==='boolean').map(change=>({laneId:change.target.id,field:field[change.control],value:change.before}))}:null;
}
// FL-style Undo history names: what changed, then the channel ("Volume – Engine context").
const MIXER_CONTROL_LABELS={gain:'Volume',pan:'Pan',mute:'Mute',solo:'Solo'};
function mixerStepLabel(kind,name){return `${kind} – ${name||'Mixer'}`;}
function retainMixerHistory(saved,{target,rowKey,control,before,after,label=null}){
 // Bus/master pan (338, live only, not saved with the project) is undoable too; its guard is the live mix.
 // Return and Main volume (setBusGain / setMasterGain, saved) are undoable like a track fader (Live: one step per drag).
 if(target.kind!=='lane'&&!(target.kind==='bus'&&(control==='pan'||control==='gain'))||!MIXER_HISTORY_CONTROLS.has(control)||before===undefined||before===null||sameMixerValue(before,after))return;
 const scope=engine.patternHistory.context();
 saved.then(()=>{
  const apply=async(from,to)=>{
   // QA round 25: the strip and the Playlist LED show the step's value when ⌘Z/⌘⇧Z is pressed
   // (optimistic), before the save; a refusal puts the previous value back.
   const change={target,control,value:to};showMixerPending([change]);
   try{const result=await restMixer.setControl(target,control,to,{expected:from});holdMixerValues([change]);const row=currentMixerModel().rows.find(item=>item.key===rowKey);if(row)sendLiveMixerFinal(row,control,to);mixerChanged();scheduleMixerRefresh();return{target,control,value:to,status:result.receipt?.status??null};}
   catch(error){if(error?.studioMixerReceipt?.attempted===false||['studio_mixer_busy','studio_mixer_scope_changed','studio_mixer_history_conflict'].includes(error?.code))error.dispatched=false;if(isMixRevisionConflict(error)){error.historyNotApplied=true;noteMixConflict(error);}rollbackMixerPending([change],[{target,control,value:from}],error);throw error;}
  };
  engine.patternHistory.recordExternalStep({kind:'mixer',label:label||'Mixer',scope,detail:{laneId:target.id,control,before,after},
   // ⌘Z/⌘⇧Z: the strips repaint and the engine hears the value at the key press (mozart-control); the save follows. A rollback restores both.
   previewUi:direction=>{const to=direction==='undo'?before:after,from=direction==='undo'?after:before,change={target,control,value:to};showMixerPending([change]);try{const row=currentMixerModel().rows.find(item=>item.key===rowKey);if(row)sendLiveMixerFinal(row,control,to);}catch{}
    return()=>{settleMixerPending([change]);try{const row=currentMixerModel().rows.find(item=>item.key===rowKey);if(row)sendLiveMixerFinal(row,control,from);}catch{}mixerChanged();};},cascade:mixerCascade([{target,control,value:after,before}]),undo:()=>apply(after,before),redo:()=>apply(before,after)});
 },()=>{});
}
async function mixerControl({row,before,value,scope,wait=false,reset=false},control){
 // The drag is over: no queued live sweep may follow this value (the saved write below waits for the one in flight).
 liveMixSweep.finish(liveMixSweepKey({kind:row?.kind,id:row?.id},control));
 if(JSON.stringify(scope)!==JSON.stringify(mixerScope())||!mixerControlEditable())throw new Error('The mixer changed before this control was applied.');
 const actual=currentMixerModel().rows.find(item=>item.key===row.key);if(!actual?.controls[control]?.enabled)throw new Error('Reload the current mixer control before changing it.');
 // FL/Pro: the engine hears the change now over mozart-control and the view shows
 // it immediately; the queue persists the latest value per control, every click counts.
 if(restMixer?.isRestMode){const cascade=mixerCascade([{target:{kind:actual.kind,id:actual.id},control,value}]);if(cascade)engine.patternHistory?.expectCascade?.(cascade.after);const live=sendLiveMixerFinal(actual,control,value);if(control!=='gain'&&control!=='pan')clientLog('mixer-click',{control,laneId:actual.id,kind:actual.kind,value,before,liveSent:live,liveStatus:engine.liveControl?.stats?.last?.status??null,queued:mixerQueue.entries.size,inFlight:restMixer.busy});const gestureBefore=before??actual.values[control].value,saved=mixerQueue.set({kind:actual.kind,id:actual.id},control,value,{scope:mixerScope(),before:actual.values[control].value});retainMixerHistory(saved,{target:{kind:actual.kind,id:actual.id},rowKey:actual.key,control,before:gestureBefore,after:value,label:mixerStepLabel(reset?'Reset':MIXER_CONTROL_LABELS[control]||'Mixer',actual.name)});return wait?saved:undefined;}
 if(!sameMixerValue(actual.values[control].value,before))throw new Error('Reload the current mixer control before changing it.');
 mixerLastOperation=control==='pan'?'pan':actual.kind==='bus'&&actual.id==='master'?'master':'bus';
 if(control==='pan'){if(actual.kind!=='lane')throw new Error('Select a lane to change pan.');try{const result=await mixerPan.setPan(actual.id,value);toast(result.receipt.status==='confirmed_reload_pending'?'Lane pan saved; engine reload pending.':'Lane pan confirmed.');return result;}finally{renderMixer();}}
 if(actual.kind==='bus'&&actual.id==='master'){if(control!=='gain')throw new Error('Only master gain is supported.');try{const result=await mixerMaster.setGain(value);toast(result.receipt.status==='confirmed_reload_pending'?'Master gain saved; engine reload pending.':'Master gain confirmed.');return result;}finally{renderMixer();}}
 if(actual.kind==='bus'){
  try{const result=await mixerLive.setControl(actual.id,control,value);toast(result.receipt.status==='confirmed_reload_pending'?'Bus saved and observed; Freestyle still reports an engine reload pending.':'Bus control confirmed in live and saved state.');return result;}finally{renderMixer();}
 }
 const channel=mixerEditableChannel(actual,control),field=control==='gain'?'volume':control;if(channel[field]!==before)throw new Error('Wait for the lane control to synchronize with Freestyle.');return edit(()=>{channel[field]=value;});
}
function typeMixerLevel({row,before,scope,bounds}){
 const assertCurrent=()=>{const current=currentMixerModel().rows.find(item=>item.key===row.key);if(JSON.stringify(scope)!==JSON.stringify(mixerScope())||!mixerControlEditable()||engine.interacting||!current?.controls.gain?.enabled||current.values.gain.value!==before)throw new Error('The mixer changed. Reopen this level control.');};
 assertCurrent();const d=dialog(`${row.name||'Mixer'} · Level`,`<form class="mixer-level-form"><label>Level (dB)<input class="mixer-level-value" aria-label="Level in decibels" inputmode="decimal" value="${before===0?'−∞':String(20*Math.log10(before))}" required></label><p>Enter −∞ for silence. Maximum ${Math.floor(20*Math.log10(bounds.max)*100)/100} dB.</p><button type="submit" class="primary">Apply</button><button type="button" class="mixer-level-cancel">Cancel</button><p class="mixer-level-status" role="status"></p></form>`),input=d.querySelector('input'),apply=d.querySelector('[type=submit]'),status=d.querySelector('.mixer-level-status');let pending=false,attempted=false;
 input.select();d.querySelector('.mixer-level-cancel').onclick=()=>d.close();d.querySelector('form').onsubmit=async event=>{event.preventDefault();if(pending||attempted||!d.isConnected)return;let gain;
  try{assertCurrent();const text=input.value.trim();if(!text)throw new Error('Enter a level in decibels.');const silence=/^(?:[-−]inf(?:inity)?|[-−]∞|mute)$/i.test(text);if(!silence&&!Number.isFinite(Number(text)))throw new Error('Enter a finite decibel value, or −∞ for silence.');gain=silence?0:10**(Number(text)/20);if(!Number.isFinite(gain)||gain<bounds.min||gain>bounds.max)throw new Error(`Level must be at most ${20*Math.log10(bounds.max)} dB.`);if(Math.abs(gain-before)<=Math.max(1,Math.abs(before))*1e-12){d.close();return;}}
  catch(error){status.textContent=error.message;return;}
  pending=attempted=true;input.disabled=apply.disabled=true;status.textContent='Applying level…';try{await mixerControl({row,before,value:gain,scope,wait:true},'gain');if(d.isConnected)d.close();}catch(error){if(d.isConnected)status.textContent=error.message;}finally{pending=false;}
 };return d;
}
// ---- Agent-safe mixing: live mix revision, outside edits, conflicts --------
function syncMixRevision(){if(!mixRevision)return;const projectId=engine.ready&&!engine.loading&&engine.session.rawState?.studioApi===true?engine.projectId:null;if(projectId)mixRevision.start(projectId);else mixRevision.stop();}
/** Someone else (a person's Studio fader, another agent) changed the mix:
 * repaint from the live state without a project reload, once the UI is idle. */
function mixExternalChange({changes,source,revision}){clientLog('mix-external-change',{source,revision,count:changes.length,keys:changes.slice(0,8).map(change=>change.key)});if(!mixAdoptTimer)mixAdoptTimer=setTimeout(adoptExternalMix,0);}
function adoptExternalMix(){
 mixAdoptTimer=null;const mix=mixRevision?.mix;if(!mix||mixRevision.projectId!==engine.projectId)return;
 if(!engine.ready||engine.loading||engine.applying||engine.pending||engine.interacting||engine.historyPending){mixAdoptTimer=setTimeout(adoptExternalMix,300);return;}
 mixerQueue?.releaseHeld();if(engine.session.adoptEngineMix?.(mix))clientLog('mix-external-adopted',{revision:mix.mixRevision});
}
/** The live engine mix (seed, mix:wait, our acknowledged writes) is what the
 * Mixer strips, Channel Rack knobs and Playlist headers show (live is what you
 * hear; saved catches up). It waits while a fader/knob gesture is active (the
 * gesture is bound to the value it started from) and lands right after. */
function showLiveMix(mix){
 clearTimeout(liveMixTimer);liveMixTimer=null;const projectId=mixRevision?.projectId??null;
 if(!mix||!projectId){if(shownLiveMix){shownLiveMix=null;clearLiveMixOverlays();mixerValuesChanged();}return;}
 if(engine.interacting||mixerView?.active||activeRackKnob||liveMixGestures>0){liveMixTimer=setTimeout(()=>showLiveMix(mixRevision?.mix),100);return;}
 shownLiveMix={projectId,mix};setLiveMixOverlay(projectId,mix);mixerValuesChanged();
}
let lastMixConflictAt=0;
/** 412 mix_revision_conflict: nothing was applied, the server mix is adopted. */
function noteMixConflict(error){const now=Date.now();clientLog('mix-conflict',{code:error?.code??null,currentMixRevision:error?.currentMixRevision??null,dispatched:error?.dispatched??null});if(mixRevision?.available(engine.projectId)&&error?.dispatched!==false&&!error?.studioMixerReceipt?.mixConflicts)mixRevision.refresh({source:'conflict'}).catch(()=>{});if(now-lastMixConflictAt>250)toast(MIX_CONFLICT_NOTICE);lastMixConflictAt=now;}
function mixApplyAvailable(){try{return !!restMixer?.isRestMode&&restMixer.mixGuarded(restMixer.capture());}catch{return false;}}
/** Several controls as ONE mix:apply step (one Undo step, whose inverse is the
 * response's undo_changes; Undo/Redo are guarded by a fresh mix revision). */
async function mixerApplyMany(changes,{label='Mixer'}={}){
 if(!mixApplyAvailable())throw new Error('Reload the mixer: multi-control moves need the live mix revision.');
 if(mixerQueue?.busy)throw new Error('Wait for the current mixer change to save.');
 const history=engine.patternHistory,cascade=mixerCascade(changes);if(cascade)history.expectCascade?.(cascade.after);let pending=null;try{pending=history.beginExternalStep({kind:'mixer',label});}catch{pending=null;}
 try{
  // mix:apply for everything it supports; pattern-lane mute/solo through their
  // guarded per-lane setters; one history step with the exact inverse.
  const result=await restMixer.applyChanges(changes),forward=result.changes,inverse=result.inverse;
  const apply=async(list,expected)=>{showMixerPending(list);try{const step=await restMixer.applyChanges(list,{expected});holdMixerValues(step.changes||list);mixerChanged();scheduleMixerRefresh();return{changes:step.changes,status:'confirmed'};}catch(error){if(error?.studioMixerReceipt?.attempted===false||['studio_mixer_busy','studio_mixer_scope_changed','studio_mixer_history_conflict'].includes(error?.code))error.dispatched=false;if(isMixRevisionConflict(error)){error.historyNotApplied=true;noteMixConflict(error);}rollbackMixerPending(list,expected,error);throw error;}};
  if(pending)history.finishExternalStep(pending,{undo:()=>apply(inverse,forward),redo:()=>apply(forward,inverse),detail:{label,controls:forward.length},cascade});
  pending=null;holdMixerValues(forward);mixerChanged();scheduleMixerRefresh();return result;
 }catch(error){if(pending)history.failExternalStep(pending,error);pending=null;if(isMixRevisionConflict(error))noteMixConflict(error);throw error;}
 finally{if(pending)history.failExternalStep(pending,{operationUncertain:true});}
}
/** FL Alt+solo: this strip soloed and every other solo cleared as one mix step
 * (pressing it again on the only soloed strip un-solos it). */
// FL Mixer multi-select (QA19): Ctrl/⌘+click toggles a strip, Shift+click
// selects the range from the focused strip; a plain click selects one.
let mixerSelection=[];
function mixerStripOrder(){return [...($('#mixer-strips')?.querySelectorAll('[data-mixer-row]')||[])].map(node=>node.dataset.mixerRow);}
function mixerSelectedKeys(){const primary=currentMixerRow()?.key??null,live=new Set(currentMixerModel().rows.map(row=>row.key)),keys=mixerSelection.filter(key=>live.has(key));return primary==null?keys:keys.includes(primary)?keys:[primary];}
/** Updates the selection; returns the key that becomes the focused strip. */
function mixerSelectStrip(key,{toggle=false,range=false}={}){
 const current=mixerSelectedKeys(),primary=currentMixerRow()?.key??null;
 if(range&&primary!=null){const order=mixerStripOrder(),from=order.indexOf(primary),to=order.indexOf(key);if(from>=0&&to>=0){mixerSelection=order.slice(Math.min(from,to),Math.max(from,to)+1);return key;}}
 if(toggle){if(current.includes(key)&&current.length>1){mixerSelection=current.filter(item=>item!==key);return mixerSelection.at(-1);}mixerSelection=[...current.filter(item=>item!==key),key];return key;}
 mixerSelection=[key];return key;
}
/** M/S on one of several selected strips: every selected lane takes the clicked strip's new value, as ONE mix:apply and ONE history step. */
function mixerToggleMany({rows,anchor,control,value,scope}){
 if(JSON.stringify(scope)!==JSON.stringify(mixerScope())||!mixerControlEditable())throw new Error('The mixer changed before this control was applied.');
 if(!['mute','solo'].includes(control)||typeof value!=='boolean')throw new Error('Only Mute and Solo apply to several strips at once.');
 if(!mixApplyAvailable())throw new Error('Reload the mixer: changing several strips at once needs the live mix revision.');
 const model=currentMixerModel().rows,changes=rows.flatMap(row=>{const fresh=model.find(item=>item.key===row.key);if(!fresh?.controls?.[control]?.enabled||!fresh.values?.[control]?.known)throw new Error('Reload the current mixer control before changing it.');return fresh.values[control].value===value?[]:[{target:{kind:'lane',id:fresh.id},control,value,before:fresh.values[control].value}];});
 clientLog('mixer-toggle-many',{control,value,lanes:rows.map(row=>row.id),changes:changes.length,anchor:anchor?.id??null});
 if(!changes.length)return null;
 return mixerApplyMany(changes,{label:mixerStepLabel(MIXER_CONTROL_LABELS[control],`${rows.length} tracks`)}).catch(fail);
}
/** A confirmed mixer write (incl. history Undo/Redo) shows its value at once in the saved
 * model the Mixer strips and the Playlist track LEDs read (held, like a queued save), until
 * the deferred canonical re-read releases it — instead of the stale row until that read. */
function holdMixerValues(changes){
 settleMixerPending(changes);if(!mixerQueue)return;let held=false;
 for(const change of changes||[]){const target=change?.target;if(!target||!['gain','pan','mute','solo'].includes(change.control)||change.value===undefined)continue;mixerQueue.held.set(MixerControlQueue.key({kind:target.kind,id:target.id},change.control),change.value);held=true;}
 if(held){mixerModelEpoch++;try{syncPlaylistTrackLeds();}catch{}}
}
/** Optimistic history repaint: show the values a mixer Undo/Redo is about to write. They live
 * apart from the queue's held values, which an earlier save's deferred re-read releases. */
const mixerChangeKey=change=>MixerControlQueue.key({kind:change.target.kind,id:change.target.id},change.control);
function showMixerPending(changes){for(const change of changes||[])if(change?.target&&change.value!==undefined)mixerHistoryPending.set(mixerChangeKey(change),change.value);mixerModelEpoch++;try{syncPlaylistTrackLeds();}catch{}mixerChanged();}
function settleMixerPending(changes){let any=false;for(const change of changes||[])if(change?.target&&mixerHistoryPending.delete(mixerChangeKey(change)))any=true;if(any)mixerModelEpoch++;}
/** A refused write (nothing applied) shows the previous values again; an uncertain one
 * drops the optimistic values and lets the canonical re-read decide. */
function rollbackMixerPending(changes,previous,error){
 settleMixerPending(changes);
 const refused=error?.dispatched===false||error?.historyNotApplied===true||error?.explicitRejection===true&&error?.operationUncertain!==true;
 if(refused)holdMixerValues(previous);else{for(const change of changes||[])if(change?.target)mixerQueue?.held.delete(mixerChangeKey(change));mixerModelEpoch++;try{syncPlaylistTrackLeds();}catch{}scheduleMixerRefresh();}
 mixerChanged();
}
function soloExclusive({row,scope,routing=false,fromMute=false}){
 if(!mixApplyAvailable())return mixerControl({row,before:row.values.solo.value,value:!row.values.solo.value,scope},'solo');
 if(JSON.stringify(scope)!==JSON.stringify(mixerScope())||!mixerControlEditable())throw new Error('The mixer changed before this control was applied.');
 const rows=currentMixerModel().rows.filter(item=>item.kind==='lane'&&item.controls?.solo?.enabled&&item.values?.solo?.known),target=rows.find(item=>item.key===row.key);
 if(!target)throw new Error('Reload the current mixer control before changing it.');
 const others=rows.filter(item=>item!==target&&item.values.solo.value),changes=target.values.solo.value&&!others.length?[{target:{kind:'lane',id:target.id},control:'solo',value:false,before:true}]:[...target.values.solo.value?[]:[{target:{kind:'lane',id:target.id},control:'solo',value:true,before:false}],...others.map(item=>({target:{kind:'lane',id:item.id},control:'solo',value:false,before:true}))];
 // FL Alt+click on the mute switch: "solo with routing" also solos the bus this track feeds (master is never soloed).
 const routed=routing&&changes.some(change=>change.target.id===target.id&&change.value===true)?target.output?.runtime?.id??target.output?.persisted?.id:null,bus=routed&&routed!=='master'?currentMixerModel().rows.find(item=>item.kind==='bus'&&item.id===routed&&item.controls?.solo?.enabled&&item.values?.solo?.known&&!item.values.solo.value):null;
 if(bus)changes.push({target:{kind:'bus',id:bus.id},control:'solo',value:true,before:false});
 return mixerApplyMany(changes,{label:mixerStepLabel(fromMute?routing?'Solo with routing':'Solo':'Exclusive solo',target.name)}).catch(fail);
}
function mixerChanged(){mixerModelEpoch++;if(restMixer?.isRestMode&&!restMixer.busy&&!engine.interacting&&mixerView)renderRack();if(mixerState?.busy&&mixerState.snapshot().mutationStatus==='pending'&&!mixerLive?.busy)mixerLiveRawState=null;if(mixerView){if(mixerView.active)mixerRenderPending=true;else{mixerView.render();renderEffects();syncInspectorStrips();}renderMixerStatus();}mixerRoutingDialog?.render();}
function renderMixerStatus(){const node=$('#mixer-state');if(!node)return;if(restMixer?.isRestMode){const state=restMixer.snapshot(),receipt=state.receipt;const target=receipt?.target,rawLane=target?.kind==='lane'?project.cloud?.rawProject?.lanes?.find(lane=>lane.id===target.id):null,label=rawLane?.name||(target?.id==='master'?'Master':target?.kind==='bus'?'Bus':'Mixer'),requested=receipt?.control==='gain'?Math.round(receipt.requested*100)+'%':String(receipt?.requested??'');node.textContent=state.busy?state.status==='inspecting'?'Reading mixer setting…':`Applying ${label} ${receipt?.control||'setting'}${requested?' · '+requested:''}…`:receipt?receipt.status.replaceAll('_',' ')+(receipt.error?' · '+receipt.error:''):'Mixer settings loaded';node.dataset.state=state.status;if(receipt?.liveOnly&&!state.busy)node.textContent+=' · live only, not saved with the project';return;}const states={pan:mixerPan?.snapshot(),master:mixerMaster?.snapshot(),bus:mixerLive?.snapshot(),route:mixerRouting?.snapshot()},labels={pan:'Pan',master:'Master',bus:'Bus',route:'Route'},pending=Object.entries(states).find(([,state])=>state?.busy),routeRecovery=states.route?.receipt?.requiresInspection&&!states.route.receipt.inspection,key=routeRecovery?'route':states[mixerLastOperation]?.receipt?mixerLastOperation:Object.keys(states).find(key=>states[key]?.receipt),receipt=key?states[key].receipt:null;
 const readError=mixerInspectionError?.key===mixerInspectionKey()?mixerInspectionError.message:'';node.textContent=pending?labels[pending[0]]+': '+pending[1].status.replaceAll('_',' '):receipt?labels[key]+': '+receipt.status.replaceAll('_',' ')+(receipt.error?' · '+receipt.error:'')+(readError?' · '+readError:''):readError;
 node.dataset.state=pending?.[1]?.status||receipt?.status||(readError?'error':'idle');}

// One deferred canonical refresh after mixer saves, outside restMixer.busy: the
// write itself is confirmed from its PATCH reply, and the queue keeps the saved
// values visible until this re-read lands (no flicker, no per-click refresh).
let mixerRefreshRun=null,mixerRefreshAgain=false;function scheduleMixerRefresh(){if(mixerRefreshRun){mixerRefreshAgain=true;return mixerRefreshRun;}if(mixerQueue?.busy)return null;mixerRefreshRun=(async()=>{try{do{mixerRefreshAgain=false;await engine.refresh();}while(mixerRefreshAgain&&!mixerQueue?.busy);}catch{}finally{mixerRefreshRun=null;if(!mixerQueue?.busy)mixerQueue?.releaseHeld();renderMixer();}})();return mixerRefreshRun;}
// Mixer value/receipt changes update the strips in place (no DOM replacement),
// so fast M/S presses always land on a live element; structural changes re-render.
function mixerValuesChanged(){mixerModelEpoch++;if(restMixer?.isRestMode&&!restMixer.busy&&!mixerQueue?.busy&&!engine.interacting&&mixerView)renderRack();if(!mixerView)return;if(mixerView.active)mixerRenderPending=true;else if(!mixerView.syncControls()){mixerView.render();renderEffects();}renderMixerStatus();syncInspectorStrips();if(restMixer?.busy||mixerQueue?.busy)syncMixerControlsWhenIdle();}
/* A change reported while a save is still in flight leaves typed-level (dB) boxes disabled; re-sync once the save settles. */
let mixerIdleSyncTimer=null;function syncMixerControlsWhenIdle(tries=40){clearTimeout(mixerIdleSyncTimer);mixerIdleSyncTimer=setTimeout(()=>{mixerIdleSyncTimer=null;if((restMixer?.busy||mixerQueue?.busy)&&tries>0)return syncMixerControlsWhenIdle(tries-1);try{if(mixerView&&!mixerView.active)mixerView.syncControls();syncInspectorStrips();}catch{}},50);}
restMixer=new StudioApiMixer({engine,persistLaneMix:true,savedLaneMix:true,onChange:mixerValuesChanged,onApplied:()=>{if(!mixerQueue?.busy)scheduleMixerRefresh();}});
// Agent-safe mixing: one live-mix revision per project (getEngineMix seed, our
// write receipts, one waitEngineMix long-poll). Outside changes repaint the
// Mixer, Channel Rack and Playlist headers in place; every mix write carries it.
mixRevision=new MixRevisionTracker({client:{call:(...args)=>restMixer.client.call(...args)},onExternalChange:mixExternalChange,onMix:mix=>showLiveMix(mix)});
restMixer.mixRevision=mixRevision;engine.session.mixRevision=mixRevision;
mixerQueue=new MixerControlQueue({onIdle:()=>{if(mixerQueue.holding)scheduleMixerRefresh();},persist:async(target,control,value)=>{/* a live sweep still in flight settles first, so the saved value is the last one the engine hears */const sweeping=liveMixSweep.finish(liveMixSweepKey(target,control));if(sweeping)await sweeping;const started=performance.now();try{const result=await restMixer.setControl(target,control,value);clientLog('mixer-save',{control,laneId:target.id,value,status:result.receipt?.status,route:result.receipt?.route??null,savedConfirmed:result.savedConfirmed,ms:Math.round(performance.now()-started)});return result;}catch(error){clientLog('mixer-save',{control,laneId:target.id,value,status:error?.studioMixerReceipt?.status??null,code:error?.code??null,error:String(error?.message||error).slice(0,160),ms:Math.round(performance.now()-started)});throw error;}},isCurrent:scope=>JSON.stringify(scope)===JSON.stringify(mixerScope()),onChange:mixerValuesChanged,onError:(error,{target,control})=>{if(isMixRevisionConflict(error)){noteMixConflict(error);return;}const row=currentMixerModel().rows.find(item=>item.kind===target.kind&&item.id===target.id);if(row&&['rejected','not_sent','conflict'].includes(error?.studioMixerReceipt?.status??'not_sent')&&row.values?.[control]?.known)sendLiveMixerFinal(row,control,row.values[control].value);if(error?.code!=='studio_mixer_scope_changed')toast(error.message);}});
mixerState=new CloudMixerState({engine,onChange:mixerChanged});
// Bind a read to the canonical snapshot present at request start. A newer
// acceptance cannot inherit authorization from an older reply still in flight.
mixerPan=new CloudLanePan({engine,onChange:state=>{if(state.readStatus==='unread'&&state.readRequestSequence>(mixerPanReadRequest?.sequence||0))mixerPanReadRequest={sequence:state.readRequestSequence,rawState:project.cloud?.rawState};if(state.readStatus==='ready'&&state.readSequence>mixerPanReadSequence){mixerPanReadSequence=state.readSequence;mixerPanRawState=!!mixerPanReadRequest&&state.completedReadRequestSequence===mixerPanReadRequest.sequence&&state.readRequestSequence===mixerPanReadRequest.sequence&&mixerPanReadRequest.rawState===project.cloud?.rawState?mixerPanReadRequest.rawState:null;}mixerChanged();}});
mixerMaster=new CloudMasterGain({engine,onChange:state=>{if(state.readStatus==='unread'&&state.readRequestSequence>(mixerMasterReadRequest?.sequence||0))mixerMasterReadRequest={sequence:state.readRequestSequence,rawState:project.cloud?.rawState};if(state.readStatus==='ready'&&state.readSequence>mixerMasterReadSequence){mixerMasterReadSequence=state.readSequence;mixerMasterRawState=!!mixerMasterReadRequest&&state.completedReadRequestSequence===mixerMasterReadRequest.sequence&&state.readRequestSequence===mixerMasterReadRequest.sequence&&mixerMasterReadRequest.rawState===project.cloud?.rawState?mixerMasterReadRequest.rawState:null;}mixerChanged();}});
mixerLive=new CloudLiveMixer({engine,mixerState,onChange:state=>{if(state.liveReadStatus==='unread'&&state.readRequestSequence>(mixerLiveReadRequest?.sequence||0))mixerLiveReadRequest={sequence:state.readRequestSequence,rawState:project.cloud?.rawState};if(state.liveReadStatus==='ready'&&state.liveReadSequence>mixerLiveReadSequence){mixerLiveReadSequence=state.liveReadSequence;mixerLiveRawState=!!mixerLiveReadRequest&&state.completedReadRequestSequence===mixerLiveReadRequest.sequence&&state.readRequestSequence===mixerLiveReadRequest.sequence&&mixerLiveReadRequest.rawState===project.cloud?.rawState?mixerLiveReadRequest.rawState:null;}mixerChanged();}});
mixerRouting=new CloudMixerRouting({engine,mixerState,typedAction:new TypedMixerActions({engine}),getModel:currentMixerModel,onChange:mixerChanged});
mixerRoutingDialog=new CloudMixerRoutingDialog({routing:mixerRouting,getModel:currentMixerModel,getScope:mixerScope,isEditable:()=>directLevelEditable()&&!engine.interacting,onStatus:toast,onApplied:async()=>{await engine.refresh();renderMixer();},onInspected:async()=>{await engine.refresh();renderMixer();}});
let mixerStripViewOptions=null;const inspectorStripViews=new Set();
// Disabelton: Logic channel strips (Logic fader taper, "-6.0" readout, upper strip sections via onRendered).
mixerView=new MixerStripView(mixerStripViewOptions={onTrace:data=>clientLog('mixer-toggle',data),levelScale:logicFaderLevelScale,layout:'logic',formatLevel:logicLevelText,onRendered:host=>decorateMixerHost(host),getMeter:row=>mixerMeterDisplay(row),onTypeLevel:packet=>{try{return typeMixerLevel(packet);}catch(error){fail(error);}},onControlMenu:(event,{row,typeLevel})=>menu(event,mixerControlMenuItems(row,'gain',typeLevel)),element:$('#mixer-strips'),getModel:currentMixerModel,getScope:mixerScope,getSelectedKey:()=>currentMixerRow()?.key??null,getSelectedKeys:mixerSelectedKeys,onToggleMany:packet=>mixerToggleMany(packet),onSelect:(key,clicked,modifiers={})=>{const primary=mixerSelectStrip(key,modifiers),row=primary===key?clicked:currentMixerModel().rows.find(item=>item.key===primary)||clicked;selectedMixerKey=row.key;mixerChannel=row.id;mixerFxReadRequests.add(mixerFxKey(row));renderEffects();requestMixerInspection();},onLevel:packet=>mixerControl(packet,'gain'),onLevelLive:packet=>liveMixerControl(packet,'gain'),onPan:packet=>mixerControl(packet,'pan'),onPanLive:packet=>liveMixerControl(packet,'pan'),onMute:packet=>mixerControl(packet,'mute'),onSolo:packet=>packet.exclusive?soloExclusive(packet):mixerControl(packet,'solo'),canEditMasterGain:()=>restMixer?.isRestMode||(mixerMaster.snapshot().readStatus==='ready'&&mixerMasterRawState===project.cloud?.rawState),canEditRow:(row,control)=>restMixer?.isRestMode?row.controls[control]?.enabled:row.kind==='lane'||row.kind==='bus'&&(row.id==='master'?control==='gain'&&mixerMaster.snapshot().readStatus==='ready'&&mixerMasterRawState===project.cloud?.rawState:mixerLive.snapshot().liveReadStatus==='ready'&&mixerLiveRawState===project.cloud?.rawState),isEditable:()=>mixerControlEditable()&&!activeRackKnob,onInteraction:active=>{engine.interacting=active;if(!active&&mixerRenderPending){mixerRenderPending=false;queueMicrotask(()=>renderMixer());}},onStatus:toast});
// FL right-click on a fader/pan: Create automation clip (lane gain is clip-gain automation; pan/bus/master have no API target).
// FL: the mixer strip area never shows the browser's page menu.
$('#mixer-strips').addEventListener('contextmenu',event=>event.preventDefault(),true);
// FL insert-slot menu; the browser's own menu never opens anywhere in the FX rack.
$('#effect-rack').addEventListener('contextmenu',event=>{event.preventDefault();try{effectSlotMenu(event);}catch(error){fail(error);}});
// Diagnostics: every press in the strip area (in-flight saves included), with what it actually hit.
$('#mixer-strips').addEventListener('pointerdown',event=>{const target=event.target,toggle=target?.closest?.('[data-toggle]'),state=$('#mixer-state');clientLog('mixer-press',{area:toggle?'toggle':target?.closest?.('.strip-controls')?'controls':target?.closest?.('.fader-track')?'fader':target?.closest?.('.mixer-pan')?'pan':target?.closest?.('[data-mixer-row]')?'strip':'empty',x:Math.round(event.clientX),y:Math.round(event.clientY),statusShown:!!state&&!state.hidden&&!!state.textContent&&state.getClientRects?.().length>0,statusState:state?.dataset?.state??null,button:event.button,ctrl:event.ctrlKey||event.metaKey,isPrimary:event.isPrimary,pointerType:event.pointerType,target:(target?.tagName||'')+'.'+String(target?.className||'').slice(0,40),toggle:toggle?.dataset?.toggle??null,ariaDisabled:toggle?.getAttribute?.('aria-disabled')??null,disabled:!!toggle?.disabled,connected:!!toggle?.isConnected,row:target?.closest?.('[data-mixer-row]')?.dataset?.mixer??null,queued:mixerQueue?.entries?.size??0,inFlight:!!restMixer?.busy,active:!!mixerView?.active});},true);
$('#mixer-strips').addEventListener('contextmenu',event=>{const strip=event.target.closest?.('[data-mixer-row]'),control=event.target.closest?.('.fader-track,.strip-db,.mixer-pan');if(!strip||!control)return;event.preventDefault();event.stopPropagation();const row=currentMixerModel().rows.find(item=>item.key===strip.dataset.mixerRow);if(!row)return;const kind=control.matches('.mixer-pan')?'pan':'gain';menu(event,mixerControlMenuItems(row,kind,kind==='gain'?()=>strip.querySelector('.strip-db')?.click():null));});
/** FL mixer fader/pan right-click: Reset, Type in value, Copy/Paste value, Create automation clip. */
function mixerControlMenuItems(row,control,typeLevel){
 const current=()=>currentMixerModel().rows.find(item=>item.key===row.key),value=()=>{const state=current()?.values?.[control];return state?.known?state.value:NaN;};
 const locked=()=>!current()?.controls?.[control]?.enabled||!mixerControlEditable();
 const apply=(next,{reset=false}={})=>{const live=current();if(!live||locked())throw new Error('Wait for the current cloud edit before changing this control.');if(!Number.isFinite(next))throw new Error('Enter a finite value.');if(sameMixerValue(live.values[control].value,next))return;return mixerControl({row:live,before:live.values[control].value,value:next,scope:mixerScope(),reset},control);};
 const typeItem=control==='gain'?['Type in value…','',()=>typeLevel?.(),!typeLevel||locked()]:['Type in value…','',()=>textDialog(`${row.name||row.id} pan`,'Pan (%) · left −100, center 0, right 100',String(Math.round(value()*100)),text=>{const next=Number(text)/100;if(!(next>=-1&&next<=1))return fail(new Error('Enter pan from −100% to 100%.'));Promise.resolve().then(()=>apply(next)).catch(fail);}),locked()];
 return[['Reset',control==='gain'?'0 dB':'center',()=>apply(control==='gain'?1:0,{reset:true}),locked()],typeItem,...valueClipboardItems(control,value,apply,locked()),null,mixerAutomationItem(row,control)];
}
function renderMixer(){if(mixerView.active){mixerRenderPending=true;renderMixerStatus();return;}mixerView.render();renderEffects();renderMixerStatus();mixerRoutingDialog?.syncScope();syncPlaylistTrackLeds();}
/** Playlist track LEDs follow the saved lane mute (shared with the Mixer and track menu). */
function syncPlaylistTrackLeds(){try{for(const el of $$('#playlist .track-label'))el.querySelector('.track-enable')?.classList.toggle('off',playlistTrackLedOff(+el.dataset.track));}catch{}logicShellHooks.mixer?.();}
function resetChannelLevels(){if(mixApplyAvailable()){const changes=[];for(const row of currentMixerModel().rows.filter(row=>row.kind==='lane')){const target={kind:'lane',id:row.id};if(row.controls.gain?.enabled&&row.values.gain.known&&!sameMixerValue(row.values.gain.value,1))changes.push({target,control:'gain',value:1,before:row.values.gain.value});if(row.controls.mute?.enabled&&row.values.mute.known&&row.values.mute.value)changes.push({target,control:'mute',value:false,before:true});if(row.controls.solo?.enabled&&row.values.solo.known&&row.values.solo.value)changes.push({target,control:'solo',value:false,before:true});}if(!changes.length)return;return mixerApplyMany(changes,{label:mixerStepLabel('Reset','Mixer')}).catch(fail);}const targets=currentMixerModel().rows.filter(row=>row.kind==='lane').map(row=>{try{return{row,channel:mixerEditableChannel(row,'gain')};}catch{return null;}}).filter(Boolean);if(!targets.some(({row,channel})=>row.controls.gain.enabled&&channel.volume!==1||row.controls.mute.enabled&&channel.mute||row.controls.solo.enabled&&channel.solo))return;edit(()=>{for(const {row,channel}of targets){if(row.controls.gain.enabled)channel.volume=1;if(row.controls.mute.enabled)channel.mute=false;if(row.controls.solo.enabled)channel.solo=false;}});}
$('#mixer-refresh').onclick=()=>refreshMixer().catch(fail);$('#mixer-buses').onclick=()=>openBusSettings().catch(fail);$('#mixer-routing').onclick=()=>{if(!engine.ready)return openCloudPanel().catch(fail);try{return mixerRoutingDialog.open({laneId:currentMixerRow()?.kind==='lane'?currentMixerRow().id:undefined});}catch(error){fail(error);}};
/** After a history step changed a lane's chain: adopt the chain that step's controller confirmed
 * (no extra read) once the workspace is idle; read the live slots only when it has none. */
let mixerFxRereadTimer=null;
function rereadMixerFx(detail=null){clearTimeout(mixerFxRereadTimer);let tries=0;const tick=()=>{mixerFxRereadTimer=null;if((workspaceBusy()||engine.interacting)&&tries++<200){mixerFxRereadTimer=setTimeout(tick,25);return;}const row=currentMixerRow();if(row?.kind!=='lane'||activeEditor()!=='mixer'||detail?.laneId&&row.id!==detail.laneId)return;const key=mixerFxKey(row),prior=mixerFxStates.get(key);if(prior?.busy||prior?.reading)return;
 if(Array.isArray(detail?.plugins)){const scope=JSON.stringify(mixerScope());mixerFxStates.set(key,{plugins:detail.plugins,savedOnly:Array.isArray(detail.savedOnly)?detail.savedOnly:[],knownBypass:new Set(detail.plugins.filter(plugin=>typeof plugin.bypassed==='boolean').map(plugin=>plugin.index)),readScope:scope,acceptedProject:project,requestScope:scope,requestProject:project});renderEffects();clientLog('mixer-fx-adopted',{laneId:row.id,slots:detail.plugins.length});return;}
 mixerFxStates.delete(key);readMixerFxSlots(mixerRowChannel(row),row,JSON.stringify(mixerScope())).catch(()=>{});};mixerFxRereadTimer=setTimeout(tick,0);}
/** ⌘Z/⌘⇧Z on a plug-in step: repaint the FX rack with the expected chain at the keypress; the revert restores it if the step fails. */
function previewMixerChain({laneId,transform}){
 const row=currentMixerRow();if(row?.kind!=='lane'||row.id!==laneId||activeEditor()!=='mixer')return null;
 const key=mixerFxKey(row),prior=mixerFxStates.get(key),scope=JSON.stringify(mixerScope()),cached=!prior?.reading&&prior?.acceptedProject===project&&prior?.readScope===scope&&Array.isArray(prior.plugins),expected=transform(cached?prior.plugins:mixerRowChannel(row)?.plugins||[]);if(!expected)return null;
 const started=performance.now();mixerFxStates.set(key,{...(prior||{}),plugins:expected,knownBypass:new Set(),readScope:scope,acceptedProject:project,requestScope:scope,requestProject:project,preview:true,reading:false,busy:false});renderEffects();clientLog('mixer-fx-preview',{laneId,slots:expected.length,ms:Math.round(performance.now()-started)});
 return()=>{if(!mixerFxStates.get(key)?.preview)return;if(prior)mixerFxStates.set(key,prior);else mixerFxStates.delete(key);renderEffects();};
}
function mixerFxKey(row){return JSON.stringify([engine.projectId,row?.kind,row?.id]);}
async function readMixerFxSlots(c,row,scope,{device=false}={}){
 // A background display read: while history or another cloud edit runs it waits for the next render instead of failing (that failure was reported as the running Undo's error).
 // Device View reads (device:true) share the load's prewarmed/in-flight inventory for the same saved chain instead of re-listing it.
 const key=mixerFxKey(row),prior=mixerFxStates.get(key);if(prior?.busy||prior?.reading||engine.interacting||workspaceBusy()||rangeBusy()||activeEditor()!=='mixer'&&!device||scope!==JSON.stringify(mixerScope()))return;
 const owner=project,options=scopedMixerOptions(c),controller=new MixerToolsController(options),state={...prior,controller,reading:true,requestScope:scope,requestProject:owner,readError:null};mixerFxStates.set(key,state);renderEffects();
 try{await controller.refreshPlugins({cached:device});options.assertScope();if(project!==owner||scope!==JSON.stringify(mixerScope())||mixerFxStates.get(key)!==state)return;state.plugins=controller.plugins;state.savedOnly=controller.savedOnlyPlugins();state.knownBypass=controller.knownBypassIndexes;state.readScope=scope;state.acceptedProject=owner;}
 catch(error){if(project===owner&&scope===JSON.stringify(mixerScope())&&mixerFxStates.get(key)===state)state.readError=error.message;}
 finally{state.reading=false;renderEffects();}
}
async function bypassEffectSlot(c,plugin,row,scope,owner){
 if(owner!==project||scope!==JSON.stringify(mixerScope()))throw new Error('The Mixer changed. Use its current effect control.');
 const key=mixerFxKey(row),prior=mixerFxStates.get(key);if(prior?.busy||prior?.reading)return false;
 if(prior?.controller?.pluginMutation?.requiresInspection)return openSelectedMixerTools(c);
 if(!(prior?.plugins===c?.plugins?prior.knownBypass?.has(plugin.index):(c?.plugins||[]).some(item=>(item.index??item.plugin_index)===plugin.index&&typeof item.bypassed==='boolean')))throw new Error('Read this effect’s bypass state in FX options before toggling it.');
 if(!directLevelEditable()||engine.interacting)throw new Error('Finish the current edit before changing effect bypass.');
 const options=scopedMixerOptions(c),controller=new MixerToolsController(options),state={...prior,busy:true,controller,error:null};
 if(controller.pluginMutation?.requiresInspection){mixerFxStates.set(key,{...state,busy:false});renderEffects();return openSelectedMixerTools(c);}
 mixerFxStates.set(key,state);renderEffects();
 try{
  await engine.flush();options.assertScope();if(owner!==project||scope!==JSON.stringify(mixerScope()))throw new Error('The Mixer changed before bypass was sent. Use the current effect control.');
  await controller.bypass(plugin,{expectedBypassed:plugin.bypassed});options.assertScope();state.plugins=controller.plugins;state.knownBypass=controller.knownBypassIndexes;state.readScope=JSON.stringify(mixerScope());state.acceptedProject=project;state.requestScope=state.readScope;state.requestProject=project;
  if(controller.pluginMutation?.requiresInspection)toast('Effect confirmation pending. Open FX and inspect the operation.');else toast(`${plugin.name}: ${plugin.bypassed?'enabled':'bypassed'} in Freestyle.`);
  return true;
 }catch(error){state.error=error.message;throw error;}finally{state.busy=false;renderEffects();}
}
/** FL insert-slot edits (Remove, Move): one guarded controller edit on a fresh chain read. */
async function editEffectSlot(c,plugin,row,scope,owner,edit){
 if(owner!==project||scope!==JSON.stringify(mixerScope()))throw new Error('The Mixer changed. Use its current effect control.');
 const key=mixerFxKey(row),prior=mixerFxStates.get(key);if(prior?.busy||prior?.reading)return false;
 if(!directLevelEditable()||engine.interacting)throw new Error('Finish the current edit before changing the effect chain.');
 const options=scopedMixerOptions(c),controller=new MixerToolsController(options);if(controller.pluginMutation?.requiresInspection)return openSelectedMixerTools(c);
 const state={...prior,busy:true,controller,error:null},id=plugin?.instance_id??plugin?.instanceId??plugin?.id;mixerFxStates.set(key,state);renderEffects();
 try{
  await engine.flush();options.assertScope();await controller.refreshPlugins();options.assertScope();
  const current=controller.plugins.find(item=>(item.instance_id??item.instanceId??item.id)===id);if(!current)throw new Error(`${plugin?.name||'That effect'} is no longer in this slot. The chain was refreshed.`);
  const message=await edit(controller,current);options.assertScope();
  state.plugins=controller.plugins;state.knownBypass=controller.knownBypassIndexes;state.readScope=JSON.stringify(mixerScope());state.acceptedProject=project;state.requestScope=state.readScope;state.requestProject=project;
  toast(controller.pluginMutation?.requiresInspection?'Effect confirmation pending. Open FX and inspect the operation.':message);return true;
 }catch(error){state.error=error.message;state.plugins=controller.plugins.length?controller.plugins:state.plugins;throw error;}finally{state.busy=false;renderEffects();}
}
/** FL "missing plugin" slot → Remove: deleteLanePluginInstance on the saved-only row (one call, saved chain only). */
async function removeMissingEffect(c,row,scope,owner,pluginKey){
 if(owner!==project||scope!==JSON.stringify(mixerScope()))throw new Error('The Mixer changed. Use its current effect control.');
 const key=mixerFxKey(row),prior=mixerFxStates.get(key);if(prior?.busy||prior?.reading)return false;
 if(!directLevelEditable()||engine.interacting)throw new Error('Finish the current edit before changing the effect chain.');
 const options=scopedMixerOptions(c),controller=new MixerToolsController(options);if(controller.pluginMutation?.requiresInspection)return openSelectedMixerTools(c);
 const state={...prior,busy:true,controller,error:null};mixerFxStates.set(key,state);renderEffects();
 try{
  await engine.flush();options.assertScope();await controller.refreshPlugins();options.assertScope();
  const missing=controller.savedOnlyPlugins().find(item=>item.pluginKey===pluginKey);if(!missing)throw new Error('That missing plugin is no longer in the saved chain. The chain was refreshed.');
  await controller.removeSavedOnly(missing);options.assertScope();
  state.plugins=controller.plugins;state.savedOnly=controller.savedOnlyPlugins();state.knownBypass=controller.knownBypassIndexes;state.readScope=JSON.stringify(mixerScope());state.acceptedProject=project;state.requestScope=state.readScope;state.requestProject=project;
  toast(controller.pluginMutation?.requiresInspection?'Effect confirmation pending. Open FX and inspect the operation.':`Missing ${missing.name} removed from ${c?.name||'this track'}’s saved chain.`);return true;
 }catch(error){state.error=error.message;throw error;}finally{state.busy=false;renderEffects();}
}
function effectSlotMenu(event){
 const slot=event.target.closest?.('.effect-slot');if(!slot)return;event.preventDefault();event.stopPropagation();
 const owner=project,row=currentMixerRow(),base=mixerRowChannel(row),scope=JSON.stringify(mixerScope()),state=mixerFxStates.get(mixerFxKey(row)),cached=!state?.reading&&state?.acceptedProject===owner&&state?.readScope===scope&&Array.isArray(state.plugins),c=cached?{...base,plugins:state.plugins}:base,plugins=normalizeLoadedPlugins(c?.plugins).filter(plugin=>Number.isInteger(plugin.index)&&plugin.index>=0);
 const button=slot.querySelector('[data-plugin]'),index=button?Number(button.dataset.plugin):[...slot.parentElement.children].indexOf(slot),plugin=button?plugins.find(item=>item.index===index):null;if(!c||button&&!plugin)return;
 const bypassKnown=!!plugin&&(cached?!!state.knownBypass?.has(plugin.index):(c.plugins||[]).some(raw=>(raw.index??raw.plugin_index)===plugin.index&&typeof raw.bypassed==='boolean'));
 const neighbour=(controller,current,delta)=>{const sorted=controller.plugins.map(item=>item.index).filter(Number.isInteger).sort((a,b)=>a-b),to=sorted[sorted.indexOf(current.index)+delta];if(!Number.isInteger(to))throw new Error(`${plugin.name} is already at the ${delta<0?'top':'bottom'} of the chain.`);return to;};
 const edit=(work)=>editEffectSlot(c,plugin,row,scope,owner,work);
 menu(event,fxSlotMenuItems({plugin,slotIndex:index,loadedIndexes:plugins.map(item=>item.index),ready:engine.ready,busy:!!state?.busy||!!state?.reading,recovery:!!state?.controller?.pluginMutation?.requiresInspection,bypassKnown,actions:{
  select:()=>openSelectedMixerTools(c,{initialTab:'catalog'}),
  replace:()=>openSelectedMixerTools(c,{initialTab:'catalog',replacePlugin:plugin}),
  editor:()=>pluginDialog(c,plugin,{nativeFirst:true}),
  bypass:()=>bypassEffectSlot(c,plugin,row,scope,owner),
  up:()=>edit(async(controller,current)=>{await controller.move(current,neighbour(controller,current,-1));return `${plugin.name} moved up.`;}),
  down:()=>edit(async(controller,current)=>{await controller.move(current,neighbour(controller,current,1));return `${plugin.name} moved down.`;}),
  // Freestyle has no lane plugin-state restore, so a removed instance (and its settings) cannot be undone faithfully.
  remove:()=>edit(async(controller,current)=>{await controller.remove(current);return `${plugin.name} removed from ${c.name||'this track'}.`;}),
 }}));
}
// FL 2026 mixer right panel (QA round 22): the Equalizer is the lane EQ stage
// (typed getLaneEq / setLaneEqBand); the output picker shows the real route and
// opens the reviewed Lane output dialog. FL's input picker, per-slot mix knob,
// stereo separation and swap phase have no Studio API field, so they are not shown.
let mixerEqSection=null;
function mixerOutputId(row){return row?.output?.runtime?.id??row?.output?.persisted?.id??null;}
function mixerOutputName(row){const id=mixerOutputId(row);if(id==null)return null;if(id==='master')return 'Master';const bus=currentMixerModel().rows.find(item=>item.kind==='bus'&&item.id===id);return bus?.name||id;}
function mixerOutputMarkup(row){
 if(!row||row.kind==='bus'&&row.id==='master')return '';
 const name=mixerOutputName(row),lane=row.kind==='lane';
 return `<div class="mixer-io mixer-output"><span class="mixer-io-icon" aria-hidden="true">⇥</span><button id="mixer-output" class="mixer-io-picker" ${lane&&engine.ready?'':'disabled'} title="${lane?'Output: '+esc(name||'(none)')+' · choose where this track is routed':'Buses feed the master output'}" aria-label="Output of ${esc(row.name||row.id)}: ${esc(name||'none')}">${esc(name||'(none)')}<span aria-hidden="true">▸</span></button></div>`;
}
// Devices QA r5: a guard refusal while mounting the mixer EQ ("Wait for the current cloud operation…" during a track
// insert, "The cloud project changed…") is an expected transient: logged as mixer-eq-load-deferred and retried once
// idle (one pending retry, still the same lane), never logged as an error.
let mixerEqRetry=null,mixerEqRetries={lane:null,count:0};
function scheduleMixerEqRetry(row,c){if(mixerEqRetry)return;if(mixerEqRetries.lane!==row?.id)mixerEqRetries={lane:row?.id??null,count:0};if(++mixerEqRetries.count>8)return;mixerEqRetry=setTimeout(async()=>{try{await pluginDialogIdle();}catch{}mixerEqRetry=null;if(!mixerEqSection&&row?.id&&currentMixerRow()?.id===row.id)mountMixerSidePanel(row,c);},400);}
function mountMixerSidePanel(row,c){
 const output=$('#mixer-output');if(output)output.onclick=()=>{try{mixerRoutingDialog.open({laneId:row.id,busId:mixerOutputId(row)});}catch(error){fail(error);}};
 const host=$('#effect-rack .mixer-eq-host');if(!host)return;
 const laneId=row?.kind==='lane'&&c?.laneId===row.id?row.id:null,projectId=engine.projectId;
 if(!laneId||!restMixer?.isRestMode||!eqSupported(STUDIO_API_OPERATIONS)){mixerEqSection?.destroy();mixerEqSection=null;return;}
 if(mixerEqSection&&(mixerEqSection.laneId!==laneId||mixerEqSection.projectId!==projectId)){mixerEqSection.destroy();mixerEqSection=null;}
 if(!mixerEqSection){try{const options=scopedMixerOptions(c);mixerEqSection=mountMixerEqSection({projectId,laneId,trackId:engine.session.trackId??null,laneName:row.name||c.name||'Track',fetch:options.fetch,historyFetch:()=>scopedMixerOptions(c,{historyStep:true}).fetch,history:engine.patternHistory,historyScope:()=>engine.patternHistory?.context?.(),log:clientLog,onError:fail,idle:pluginDialogIdle});mixerEqSection.projectId=projectId;mixerEqRetries.count=0;}catch(error){const transient=isTransientEqError(error);clientLog(transient?'mixer-eq-load-deferred':'mixer-eq-load-error',{laneId,message:String(error?.message||error).slice(0,160)});if(transient)scheduleMixerEqRetry(row,c);return;}}
 host.append(mixerEqSection.element);
}
function renderEffects(){const owner=project,row=currentMixerRow(),base=mixerRowChannel(row),scope=JSON.stringify(mixerScope()),state=mixerFxStates.get(mixerFxKey(row)),cached=!state?.reading&&state?.acceptedProject===owner&&state?.readScope===scope&&Array.isArray(state.plugins),c=cached?{...base,plugins:state.plugins}:base,name=c?.name||'Mixer',plugins=normalizeLoadedPlugins(c?.plugins),recovery=!!state?.controller?.pluginMutation?.requiresInspection;$('#mixer-selected-title').textContent='- '+name;
 if(restMixer?.isRestMode&&activeEditor()==='mixer'&&mixerFxReadRequests.has(mixerFxKey(row))&&row?.kind==='lane'&&base?.plugins.some(plugin=>plugin.index===null)&&!cached&&!state?.reading&&!state?.busy&&(state?.requestScope!==scope||state?.requestProject!==owner))queueMicrotask(()=>readMixerFxSlots(base,row,scope).catch(fail));
 const indexed=new Map(plugins.filter(plugin=>Number.isInteger(plugin.index)&&plugin.index>=0).map(plugin=>[plugin.index,plugin])),pending=savedSlotPlugins(plugins,indexed),count=Math.max(10,...[...indexed.keys(),...pending.keys()].map(index=>index+1));
 const slots=Array.from({length:count},(_,index)=>{const plugin=indexed.get(index),saved=pending.get(index),shown=plugin?.pending?plugin:!plugin?saved:null;if(shown)return `<div class="effect-slot effect-slot-loaded effect-slot-pending" aria-busy="true"><button class="cloud-plugin-slot" disabled title="Slot ${index+1} · ${esc(shown.name)} (reading its live slot…)"><span class="effect-slot-arrow" aria-hidden="true">▸</span><span class="effect-slot-name">${esc(shown.name)}</span></button></div>`;if(!plugin)return `<button class="effect-slot empty-effect-slot" data-add-effect title="Add an effect to the next free slot" ${!engine.ready?'disabled':''}><span class="effect-slot-arrow" aria-hidden="true">▸</span><span class="effect-slot-name">Slot ${index+1}</span></button>`;
  const known=cached?state.knownBypass?.has(index):(c?.plugins||[]).some(raw=>(raw.index??raw.plugin_index)===index&&typeof raw.bypassed==='boolean'),label=recovery?'Inspect effect operation':`${plugin.name} enabled`,hint=recovery?'Inspect the previous plugin operation before changing bypass':known?`${plugin.bypassed?'Enable':'Bypass'} ${plugin.name}`:'Read this effect’s bypass state in FX options';
  return `<div class="effect-slot effect-slot-loaded${plugin.bypassed?' bypassed':''}" aria-busy="${!!state?.busy}"><button class="cloud-plugin-slot effect-open" data-plugin="${index}" title="Slot ${index+1} · ${esc(plugin.name)}"><span class="effect-slot-arrow" aria-hidden="true">▸</span><span class="effect-slot-name">${esc(plugin.name)}</span></button><button class="effect-slot-led${known?'':' unknown'}${recovery?' needs-inspection':''}" data-plugin-bypass="${index}" aria-label="${esc(label)}" ${known?`aria-pressed="${!plugin.bypassed}"`:''} title="${esc(hint)}" ${!engine.ready||state?.busy||state?.reading||!known&&!recovery?'disabled':''}></button></div>`;
 }).join('');
 // FL "missing plugin" slots: saved-chain rows the live chain does not hold (from a fresh chain read only).
 const missing=(cached&&Array.isArray(state.savedOnly)?state.savedOnly:[]).map(item=>`<div class="effect-slot effect-slot-missing" data-missing-plugin="${esc(item.pluginKey)}" title="${esc(item.name)} is in the saved chain but not loaded in Freestyle"><span class="effect-slot-arrow" aria-hidden="true">!</span><span class="effect-slot-name">${esc(item.name)} <small>(missing)</small></span><button class="effect-slot-remove" data-remove-missing="${esc(item.pluginKey)}" aria-label="Remove missing ${esc(item.name)}" ${!engine.ready||state?.busy||state?.reading?'disabled':''}>Remove</button></div>`).join('');
 const unbound=plugins.filter(plugin=>(!Number.isInteger(plugin.index)||plugin.index<0)&&![...pending.values()].includes(plugin)).map(plugin=>`<button class="effect-slot cloud-plugin-slot" data-plugin="${plugin.index??''}" disabled title="Plugin slot unavailable"><span class="effect-slot-name">${esc(plugin.name)}</span></button>`).join('');
 $('#effect-rack').innerHTML=`<div class="effects-title"><span class="effect-lane-name">${esc(name)}</span><button id="cloud-more-fx" title="Effect options" aria-label="Effect options for ${esc(name)}" aria-haspopup="dialog">FX ▾</button></div>${state?.reading?'<p class="effect-read-status" role="status">Reading effect slots…</p>':state?.readError?`<p class="effect-read-status" role="status">${esc(state.readError)} <button id="effect-read-retry">Retry</button></p>`:''}<div class="effect-slots">${slots}${unbound}${missing}</div><div class="mixer-eq-host"></div>${mixerOutputMarkup(row)}`;
 mountMixerSidePanel(row,c);
 if($('#effect-read-retry'))$('#effect-read-retry').onclick=()=>readMixerFxSlots(base,row,scope).catch(fail);
 $$('#effect-rack [data-plugin]').forEach(button=>button.onclick=()=>pluginDialog(c,plugins.find(plugin=>plugin.index===+button.dataset.plugin)).catch(fail));
 $$('#effect-rack [data-remove-missing]').forEach(button=>button.onclick=event=>{event?.preventDefault();event?.stopPropagation();return removeMissingEffect(c,row,scope,owner,button.dataset.removeMissing).catch(fail);});
 $$('#effect-rack [data-plugin-bypass]').forEach(button=>button.onclick=event=>{event?.preventDefault();event?.stopPropagation();return bypassEffectSlot(c,plugins.find(plugin=>plugin.index===+button.dataset.pluginBypass),row,scope,owner).catch(fail);});
 $$('#effect-rack [data-add-effect]').forEach(button=>button.onclick=()=>openSelectedMixerTools(c,{initialTab:'catalog'}).catch(fail));$('#cloud-more-fx').onclick=()=>openSelectedMixerTools(c).catch(fail);
 // Logic strips show each strip's chain; FX state changes repaint them (and the Inspector's) here.
 decorateMixerHost($('#mixer-strips'));syncInspectorStrips();ablDevices?.api.sync();}
/* ---------- Disabelton (mixer lane): Logic channel strips, Inspector strips, plug-in bypass, automation view ---------- */
/** A strip's chain for display: a fresh live read when cached, else the saved lane chain (opened like the Channel Rack plug-in button). */
function logicRowPlugins(row){
 if(!row)return{plugins:[],c:null,state:null,cached:false};
 const scope=JSON.stringify(mixerScope()),state=mixerFxStates.get(mixerFxKey(row)),cached=!state?.reading&&state?.acceptedProject===project&&state?.readScope===scope&&Array.isArray(state.plugins),base=mixerRowChannel(row),c=cached?{...base,plugins:state.plugins}:base;
 const known=index=>cached?!!state.knownBypass?.has(index):(base?.plugins||[]).some(raw=>(raw.index??raw.plugin_index)===index&&typeof raw.bypassed==='boolean');
 const live=normalizeLoadedPlugins(c?.plugins).filter(plugin=>Number.isInteger(plugin.index)&&plugin.index>=0).map(plugin=>({...plugin,bypassKnown:known(plugin.index)}));
 const saved=row.kind==='lane'&&!cached?savedChainPlugins(row.rawPersisted?.pluginChain).filter(plugin=>!live.some(item=>item.index===plugin.index)).map(plugin=>({...plugin,bypassKnown:false})):[];
 return{plugins:[...live,...saved].sort((a,b)=>a.index-b.index),c,state,cached};
}
function logicStripColor(row){if(row?.kind!=='lane')return row?.id==='master'?'#8a8d93':'#4f86c6';
 // Disabelton QA r3: mixer strips and the Device View title use the SAME colour as the track header / clips
 // (the shell's Live palette by track position, abl-session.js ablTrackColor), never the fork's channel colour.
 {const track=(project.cloud?.timelineLaneIds||[]).indexOf(row.id);if(track>=0)return ablTrackColor(track);}
 const channel=(project.channels||[]).find(item=>!item.patternSource&&item.laneId===row.id);return channelColor(channel?.color)||colors[Math.max(0,(project.cloud?.timelineLaneIds||[]).indexOf(row.id))%colors.length];}
function logicStripSpec(key){
 const row=currentMixerModel().rows.find(item=>item.key===key);if(!row)return null;
 const {plugins,state}=logicRowPlugins(row),{instrument,effects}=splitLogicChain(plugins,row.laneKind,{instrumentTypes:logicInstrumentTypes()}),eq=logicEqPlugin(plugins),lane=row.kind==='lane',master=row.kind==='bus'&&row.id==='master';
 const laneEq=lane&&!!restMixer?.isRestMode&&eqSupported(STUDIO_API_OPERATIONS),output=mixerOutputName(row);
 return{row,color:logicStripColor(row),instrument,effects,busy:!engine.ready||!!state?.busy||!!state?.reading,canAdd:engine.ready,status:state?.reading?'Reading effect slots…':state?.readError||state?.error||'',
  eq:{enabled:engine.ready&&(!!eq||laneEq),active:!!eq&&!eq.bypassed,title:eq?`${logicPluginName(eq)} · click to open`:laneEq?'Channel EQ · click to open':'Channel EQ: this channel has no EQ in Freestyle'},
  output:master?{name:'Output 1-2',enabled:false,title:'Stereo Out plays through the Freestyle cloud output'}:lane?{name:output&&output!=='Master'?output:'Stereo Out',enabled:engine.ready,title:`Output: ${output||'Stereo Out'} · click to route this track`}:{name:'Stereo Out',enabled:false,title:'Buses feed the Stereo Out'},mode:'Read'};
}
/** Logic selects a strip when one of its slots is used (Mixer selection, FX read request). */
function selectLogicStrip(row){try{mixerView?.select(currentMixerModel().rows.find(item=>item.key===row.key)||row);}catch(error){clientLog('logic-strip-select-error',{message:String(error?.message||error).slice(0,160)});}}
function logicSlotMenu(row,plugin,event){
 const owner=project,scope=JSON.stringify(mixerScope()),{plugins,c,state}=logicRowPlugins(row),loaded=plugins.filter(item=>Number.isInteger(item.index)&&item.index>=0);
 const neighbour=(controller,current,delta)=>{const sorted=controller.plugins.map(item=>item.index).filter(Number.isInteger).sort((a,b)=>a-b),to=sorted[sorted.indexOf(current.index)+delta];if(!Number.isInteger(to))throw new Error(`${plugin.name} is already at the ${delta<0?'top':'bottom'} of the chain.`);return to;};
 const edit=work=>editEffectSlot(c,plugin,row,scope,owner,work);
 menu(event,fxSlotMenuItems({plugin,slotIndex:plugin.index,loadedIndexes:loaded.map(item=>item.index),ready:engine.ready,busy:!!state?.busy||!!state?.reading,recovery:!!state?.controller?.pluginMutation?.requiresInspection,bypassKnown:!!plugin.bypassKnown,actions:{
  select:()=>openSelectedMixerTools(c,{initialTab:'catalog'}),replace:()=>openSelectedMixerTools(c,{initialTab:'catalog',replacePlugin:plugin}),editor:()=>pluginDialog(c,plugin,{nativeFirst:true}),bypass:()=>bypassEffectSlot(c,plugin,row,scope,owner),
  up:()=>edit(async(controller,current)=>{await controller.move(current,neighbour(controller,current,-1));return `${plugin.name} moved up.`;}),
  down:()=>edit(async(controller,current)=>{await controller.move(current,neighbour(controller,current,1));return `${plugin.name} moved down.`;}),
  remove:()=>edit(async(controller,current)=>{await controller.remove(current);return `${plugin.name} removed from ${c?.name||'this track'}.`;}),
 }}));
}
/** The lane EQ stage (getLaneEq / setLaneEqBand, one Undo step per band gesture) in its own Logic Channel EQ window. */
function openLaneEqWindow(row,c){
 if(row?.kind!=='lane'||!restMixer?.isRestMode||!eqSupported(STUDIO_API_OPERATIONS))throw new Error('Channel EQ needs the Studio API lane EQ for this track.');
 const options=scopedMixerOptions(c),d=dialog(row.name||'Track','',{modeless:true,className:'plugin-parameter-dialog logic-plugin-window logic-eq-window'});
 const section=mountMixerEqSection({projectId:engine.projectId,laneId:row.id,trackId:engine.session.trackId??null,laneName:row.name||'Track',fetch:options.fetch,historyFetch:()=>scopedMixerOptions(c,{historyStep:true}).fetch,history:engine.patternHistory,historyScope:()=>engine.patternHistory?.context?.(),log:clientLog,onError:fail});
 const name=document.createElement('div');name.className='logic-plugin-subheader';name.innerHTML='<span class="logic-plugin-name">Channel EQ</span>';d.querySelector('.dialog-content').append(name,section.element);d.addEventListener('close',()=>section.destroy?.(),{once:true});return d;
}
function logicStripHandlers(){
 const open=(row,plugin)=>{selectLogicStrip(row);return pluginDialog(logicRowPlugins(row).c,plugin,{nativeFirst:true});};
 return{onError:fail,
  onSetting:(row,event)=>{const live=currentMixerModel().rows.find(item=>item.key===row.key)||row,gain=mixerControlMenuItems(live,'gain',null)[0],pan=mixerControlMenuItems(live,'pan',null)[0],c=mixerRowChannel(live);menu(event,[['Reset Volume',gain[1],gain[2],gain[3]],['Reset Pan',pan[1],pan[2],pan[3]],null,...(live.kind==='lane'?[...channelStripSettingEntries(live.id),null]:[]),{label:'Copy effects chain…',disabled:!engine.ready||!c,title:'Copy this channel’s effect chain to another track',run:()=>openSelectedMixerTools(c)}]);},
  onEq:row=>{selectLogicStrip(row);const {plugins,c}=logicRowPlugins(row),eq=logicEqPlugin(plugins);return eq?pluginDialog(c,eq):openLaneEqWindow(row,c);},
  onInstrument:open,onOpenPlugin:open,
  // The slot's rectangle is read before selecting the strip (selection repaints the strips and detaches the slot).
  onAddPlugin:(row,slot,event)=>{const node=event?.target?.closest?.('.logic-fx-slot,.logic-audio-fx')||event?.target,rect=node?.getBoundingClientRect?.()||null;selectLogicStrip(row);return addLogicPlugin(row,event,rect);},
  onBypass:(row,plugin)=>{if(!plugin.bypassKnown){selectLogicStrip(row);toast(`Reading ${logicPluginName(plugin)}’s live bypass state; click its power button again once the slot is read.`);return;}return bypassEffectSlot(logicRowPlugins(row).c,plugin,row,JSON.stringify(mixerScope()),project);},
  onSlotMenu:(row,plugin,event)=>logicSlotMenu(row,plugin,event),
  onMove:(row,plugin,to)=>editEffectSlot(logicRowPlugins(row).c,plugin,row,JSON.stringify(mixerScope()),project,async(controller,current)=>{await controller.move(current,to);return `${logicPluginName(plugin)} moved to slot ${to+1}.`;}),
  onOutput:row=>mixerRoutingDialog.open({laneId:row.id,busId:mixerOutputId(row)}),
  onMode:(row,event)=>menu(event,logicModeMenu())};
}
let logicInstrumentTypeSet=null;
function logicInstrumentTypes(){return logicInstrumentTypeSet||=new Set([...LOGIC_INSTRUMENT_TYPES,...NATIVE_PLUGIN_CATALOG.filter(item=>item.kind==='instrument').map(item=>String(item.type).toLowerCase())]);}
/**
 * Logic insert slot: a compact Category ▸ Plug-in menu (with search) anchored at
 * the slot; choosing closes it, adds through the existing guarded add (one Undo
 * step) and opens the new plug-in's window.
 */
async function addLogicPlugin(row,event,rect=null){
 if(!engine.ready)return openCloudPanel();
 const c=mixerRowChannel(row),anchor=event?.target?.closest?.('.logic-fx-slot')||event?.target||null;
 let controller;const popup=openLogicPluginMenu(document,{anchor,rect,title:`${row.name||'Track'} Audio FX`,onPick:entry=>{Promise.resolve().then(()=>insertLogicPlugin(row,c,controller,entry)).catch(fail);}});
 try{controller=new MixerToolsController(scopedMixerOptions(c));await controller.readCatalog({checkHost:true,cached:true});}
 catch(error){popup.close();throw error;}
 const id=item=>controller.isRestMode?item.id:item.path,category=item=>typeof item.category==='string'&&item.category.trim()?item.category.trim():item.availability==='loaded'?'Loaded in this session':'Other';
 popup.setEntries((controller.catalog||[]).filter(item=>id(item)).map(item=>({id:id(item),name:item.name||item.label||id(item),category:category(item),disabled:!!item.hostGated,title:item.hostGated?'Not installed on this Freestyle host':''})));
}
async function insertLogicPlugin(row,c,controller,entry,{openWindow=true}={}){
 const owner=project,options=scopedMixerOptions(c);await engine.flush();options.assertScope();if(owner!==project)throw new Error('The project changed. Choose the plug-in again.');
 const before=new Set((controller.plugins||[]).map(plugin=>plugin.instance_id??plugin.instanceId??plugin.id));toast(`Adding ${entry.name}…`);
 // Disabelton QA r3: the status bar kept "Adding …" after the add finished. Every outcome replaces it
 // (confirmed → "added", refusal → its error via fail(), abort/scope change → cleared here).
 const addingStatus=$('#status-message')?.textContent;
 try{await controller.loadPlugin(entry.id);options.assertScope();}catch(error){const status=$('#status-message');if(status&&status.textContent===addingStatus)status.textContent='';throw error;}
 if(controller.pluginMutation?.requiresInspection){toast('Plug-in confirmation pending. Open FX and inspect the operation.');return;}
 const body=controller.pluginMutation?.result?.structuredContent??controller.pluginMutation?.result,instance=body?.instanceId??body?.response?.instance_id??body?.response?.instanceId;
 const added=controller.plugins.find(plugin=>(plugin.instance_id??plugin.instanceId??plugin.id)===instance)||controller.plugins.find(plugin=>!before.has(plugin.instance_id??plugin.instanceId??plugin.id));
 const key=mixerFxKey(row);mixerFxStates.set(key,{plugins:controller.plugins,savedOnly:controller.savedOnlyPlugins(),knownBypass:controller.knownBypassIndexes,readScope:JSON.stringify(mixerScope()),acceptedProject:project,requestScope:JSON.stringify(mixerScope()),requestProject:project});renderEffects();
 toast(`${entry.name} added to ${row.name||'this track'}.`);
 // QA r9: Studio Pro adds every chain plug-in with openEditor:false and Live opens no window for a built-in device, so a
 // Disabelton Browser/Device drop (openWindow:false) shows the device in the Device View only; nothing auto-opens.
 if(openWindow&&added&&Number.isInteger(added.index))return pluginDialog({...c,plugins:controller.plugins},added,{nativeFirst:true});
 return added?{index:added.index,instanceId:added.instance_id??added.instanceId??added.id??null}:undefined;
}
function logicModeMenu(){return logicAutomationModeItems('Read').map(item=>({label:item.mode,checked:item.checked,disabled:item.disabled,title:item.title,run:()=>{}}));}
function decorateMixerHost(host){if(!host||!project)return 0;return decorateLogicStrips(host,logicStripSpec,logicStripHandlers());}
/** Inspector bypass for a plug-in window: the same guarded bypass path as the strip's power button. */
function logicPluginBypass(c,plugin){
 const row=()=>currentMixerModel().rows.find(item=>c?.laneId?item.kind==='lane'&&item.id===c.laneId:item.kind==='bus'&&item.id===(c?.busId??c?.id));
 const current=()=>{const live=row();return live?logicRowPlugins(live).plugins.find(item=>item.index===plugin.index&&(item.instance_id??item.instanceId??item.id)===(plugin.instance_id??plugin.instanceId??plugin.id))||null:null;};
 return{state:()=>{const live=row(),item=current(),state=live?mixerFxStates.get(mixerFxKey(live)):null;return{known:!!item?.bypassKnown,bypassed:!!item?.bypassed,busy:!engine.ready||!!state?.busy||!!state?.reading};},
  toggle:()=>{const live=row(),item=current();if(!live||!item)throw new Error('This plug-in is no longer in the channel strip.');if(!item.bypassKnown){selectLogicStrip(live);throw new Error('Reading the plug-in’s live bypass state; try again in a moment.');}return bypassEffectSlot(logicRowPlugins(live).c,item,live,JSON.stringify(mixerScope()),project);}};
}
/**
 * Disabelton Inspector: a compact Logic strip pair (the selected track + Stereo Out)
 * on `element`, sharing every Mixer callback (writes, revision guards, undo, meters).
 * getLaneId() names the Inspector's track (default: the Mixer's selected strip).
 */
function mountInspectorStrips(element,{getLaneId=()=>null}={}){
 if(!element||!mixerStripViewOptions)throw new Error('The mixer is not ready for Inspector strips.');
 const rows=()=>{const model=currentMixerModel(),laneId=getLaneId(),track=(laneId&&model.rows.find(row=>row.kind==='lane'&&row.id===laneId))||currentMixerRow(),master=model.rows.find(row=>row.kind==='bus'&&row.id==='master');return [track,master].filter((row,index,list)=>row&&list.indexOf(row)===index);};
 element.classList.add('logic-inspector-strips');
 const view=new MixerStripView({...mixerStripViewOptions,element,stripClass:'logic-inspector-strip',idAttribute:'inspectorMixer',getModel:()=>({...currentMixerModel(),rows:rows()}),getSelectedKeys:null,onToggleMany:null,onInteraction:active=>{mixerStripViewOptions.onInteraction(active);if(!active)queueMicrotask(syncInspectorStrips);}});
 inspectorStripViews.add(view);view.render();
 return{view,render:()=>view.render(),sync:()=>syncInspectorStrips(),destroy:()=>{inspectorStripViews.delete(view);view.destroy();}};
}
function syncInspectorStrips(){for(const view of inspectorStripViews){if(view.destroyed||!view.element.isConnected||view.active)continue;try{if(!view.syncControls())view.render();else if(view.ablDecorate)view.ablDecorate();else decorateMixerHost(view.element);}catch(error){clientLog('inspector-strip-error',{message:String(error?.message||error).slice(0,160)});}}}
/* Logic Mixer (X): docked in the bottom pane the editors use (body.mixer-open, --logic-editor-height). */
function toggleMixer(force){const win=$('#mixer');if(!win)return false;const open=typeof force==='boolean'?force:win.classList.contains('hidden');if(open)showWindow('mixer');else closeMixerDock();return !win.classList.contains('hidden');}
function closeMixerDock(){const win=$('#mixer');if(!win)return;if(!win.classList.contains('hidden')){mixerView?.cancel?.();win.classList.add('hidden');}$$('[data-window="mixer"]').forEach(b=>b.classList.remove('lit'));document.body.classList.remove('mixer-open');applyMixerHeight(false);}
function syncMixerDock(){const win=$('#mixer');if(!win)return;const open=!win.classList.contains('hidden');if(open&&editorPaneVisible())closeEditorPane();document.body.classList.toggle('mixer-open',open);$$('[data-window="mixer"]').forEach(b=>b.classList.toggle('lit',open));applyMixerHeight(open);}
/* The Mixer opens at its own height (Logic: about half the window, every strip row visible; the
 * user's last Mixer resize is remembered); the editors get their own height back when it closes. */
var editorHeightBeforeMixer=null;
const MIXER_HEIGHT_KEY='disabelton-mixer-height';
function mixerDefaultHeight(){let saved=0;try{saved=Number(localStorage.getItem(MIXER_HEIGHT_KEY))||0;}catch{}const view=Number(innerHeight)||900,max=Math.max(240,view-200);return Math.round(Math.min(max,saved>0?saved:Math.max(560,view*.5)));}
function applyMixerHeight(open){
 const root=document.documentElement;
 if(open){if(editorHeightBeforeMixer==null)editorHeightBeforeMixer=root.style.getPropertyValue('--logic-editor-height')||'';root.style.setProperty('--logic-editor-height',`${mixerDefaultHeight()}px`);return;}
 if(editorHeightBeforeMixer==null)return;const before=editorHeightBeforeMixer;editorHeightBeforeMixer=null;
 if(before)root.style.setProperty('--logic-editor-height',before);else root.style.removeProperty('--logic-editor-height');
 // The shared resize handle stores its last drag as the editors' height: keep the editors' own value.
 const px=parseFloat(before);if(px>0)try{localStorage.setItem('disabelton-editor-height',String(px));}catch{}
}
// A drag of the Mixer's top edge is remembered as the Mixer height (after the shared handler applied it).
$('#mixer .logic-editor-resize')?.addEventListener('pointerup',()=>setTimeout(()=>{if($('#mixer')?.classList.contains('hidden'))return;const px=parseFloat(document.documentElement.style.getPropertyValue('--logic-editor-height'));if(px>0)try{localStorage.setItem(MIXER_HEIGHT_KEY,String(Math.round(px)));}catch{}},0));
function setMixerFilter(filter){const win=$('#mixer');if(!win||!['single','tracks','all'].includes(filter))return;win.dataset.mixerFilter=filter;for(const button of $$('#mixer [data-mixer-filter]')){if(button===win)continue;const on=button.dataset.mixerFilter===filter;button.classList.toggle('selected',on);button.setAttribute('aria-pressed',String(on));}}
function mixerLocalMenu(event,kind){const filter=$('#mixer')?.dataset.mixerFilter||'all',click=id=>()=>$('#'+id)?.click();
 const items={edit:[{label:'Undo',shortcut:'⌘Z',run:()=>undo()},{label:'Redo',shortcut:'⇧⌘Z',run:()=>redo()},null,{label:'Reset Volume, Mute and Solo of All Tracks',run:click('reset-mixer')}],
  options:[{label:'Route Selected Track…',title:'Choose the output (bus) of the selected track',run:click('mixer-routing')},{label:'Create Bus…',title:'Create a new bus (createBus); existing buses can be renamed and levelled in the same window',run:click('mixer-buses')},null,{label:'Refresh Mixer',run:click('mixer-refresh')}],
  view:[{label:'Single',checked:filter==='single',run:()=>setMixerFilter('single')},{label:'Tracks',checked:filter==='tracks',run:()=>setMixerFilter('tracks')},{label:'All',checked:filter==='all',run:()=>setMixerFilter('all')},null,{label:'Close Mixer',shortcut:'X',run:()=>toggleMixer(false)}]}[kind];
 if(items)menu(event,items);}
for(const [id,kind]of [['mixer-menu-edit','edit'],['mixer-menu-options','options'],['mixer-menu-view','view']])$('#'+id)?.addEventListener('click',event=>mixerLocalMenu(event,kind));
for(const button of $$('#mixer .logic-mixer-filters [data-mixer-filter]'))button.addEventListener('click',()=>setMixerFilter(button.dataset.mixerFilter));
// The toolbar Mixer button toggles the dock (FL's raise-before-hide window rule does not apply to a docked pane).
document.addEventListener('click',event=>{const button=event.target.closest?.('[data-window="mixer"]');if(!button)return;event.preventDefault();event.stopPropagation();toggleMixer();},true);
/* Logic track automation (A): headers + curves over the Tracks area lanes. */
function logicAutomationView(){
 // Disabelton: Live's Device ▾ / Control ▾ choosers and red envelopes (abl-auto.js) over the same edit paths.
 if(!logicAutomation)logicAutomation=new AblAutomationView({document,getDevices:laneId=>ablAutomationDevices(laneId),currentValue:(laneId,option)=>ablAutomationCurrentValue(laneId,option),loadDevice:(laneId,instanceId)=>ablLoadAutomationDevice(laneId,instanceId),onDeleteEnvelope:envelope=>deleteAutomationClip(envelope),getProject:()=>project,getStore:()=>automationStore,getLaneIds:()=>project?.cloud?.timelineLaneIds||[],getPluginParameters:laneId=>logicPluginParameterOptions(laneId),getPluginMenu:(laneId,pick)=>logicPluginParameterMenu(laneId,pick),onCreate:(laneId,option,at)=>createLogicAutomation(laneId,option,at),onCommit:packet=>{clearAutomationReadouts();return commitLogicAutomation(packet);},onMode:(laneId,event)=>menu(event,logicModeMenu()),menu,onStatus:text=>automationStatus(text),onRepaint:()=>paintLogicAutomation(),
  beatAt:(clientX,grid)=>(clientX-playlistGridOrigin(grid))/barWidth*4,snapBeat:beat=>quantize(beat),getProjectEndSec:()=>logicProjectEndSec()});
 return logicAutomation;
}
function paintLogicAutomation(){const host=$('#track-lanes');if(!host||!project)return;try{logicAutomationView().paint(host);}catch(error){clientLog('logic-automation-paint-error',{message:String(error?.message||error).slice(0,160)});}}
function toggleAutomationView(force){const on=logicAutomationView().toggle(force);$('#playlist')?.classList.toggle('logic-automation-view',on);paintAutomationClips();return on;}
function logicPluginParameterOptions(laneId){const out=[];for(const entry of logicPluginParams.values())if(entry.projectId===engine.projectId&&entry.laneId===laneId)out.push(...entry.options);return out;}
function logicPluginParameterMenu(laneId,pick){
 const row=currentMixerModel().rows.find(item=>item.kind==='lane'&&item.id===laneId);if(!row)return[];
 return logicRowPlugins(row).plugins.map(plugin=>{const entry=logicPluginParams.get(`${engine.projectId}|${laneId}|${plugin.instance_id??plugin.instanceId??plugin.id}`);
  if(entry)return entry.options.length?{label:logicPluginName(plugin),submenu:entry.options.map(option=>({label:option.target.name,run:pick(option)}))}:{label:logicPluginName(plugin),disabled:true,title:'This plug-in reports no automatable parameters.'};
  return{label:`${logicPluginName(plugin)} ▸ Read Parameters…`,disabled:!engine.ready,title:'Read this plug-in’s automatable parameters from Freestyle',run:()=>loadLogicPluginParameters(row,plugin).then(count=>toast(count?`${logicPluginName(plugin)}: ${count} automatable parameters. Open the parameter menu again to choose one.`:`${logicPluginName(plugin)} reports no automatable parameters.`))};});
}
async function loadLogicPluginParameters(row,plugin){
 const controller=new MixerToolsController(scopedMixerOptions(mixerRowChannel(row)));
 if(!controller.adoptSavedSlot({...plugin,savedChain:true}))await controller.ensurePlugin(plugin,{cached:true});
 await controller.readPlugin(plugin.index);for(let page=0;page<10&&controller.parameterPagination?.hasMore;page++)await controller.loadMoreParameters();
 const options=controller.parameters.map(parameter=>pluginParameterAutomation(controller,plugin,parameter)).filter(Boolean).map(spec=>({key:`lane.plugin:${spec.target.pluginInstanceId}.param:${spec.target.stableParamId}`,label:`${logicPluginName(plugin)}: ${spec.target.name}`,target:spec.target,spec}));
 logicPluginParams.set(`${engine.projectId}|${row.id}|${plugin.instance_id??plugin.instanceId??plugin.id}`,{projectId:engine.projectId,laneId:row.id,options});return options.length;
}
/** First automation for a parameter: the existing creation paths (createLaneAutomation; plug-in knob automation), one Undo step. */
/** The project's end for Logic track automation: the last region's end, at least 8 bars, rounded up to a bar. */
function logicProjectEndSec(){const perBar=project?.beatsPerBar||4,bpm=Number(project?.bpm)||120;let end=8*perBar;for(const clip of allClips?.()||[])end=Math.max(end,(Number(clip.start)||0)+(Number(clip.length)||0));
 // …and at least the visible end of the Tracks area (Logic's curve runs to the end of what you see).
 const view=$('#arrangement-scroll');if(view&&barWidth>0){const visible=((Number(view.scrollLeft)||0)+(Number(view.clientWidth)||0)-PLAYLIST_GUTTER)/barWidth*4;if(Number.isFinite(visible))end=Math.max(end,visible);}
 return Math.ceil(end/perBar)*perBar*60/bpm;}
/**
 * Logic's first click on a track's automation lane: ONE write creating the
 * envelope with the clicked point, ONE Undo step. Volume/Pan: a lane envelope
 * over the whole project, the current mixer value as its flat line. Region
 * parameters (plug-in parameters, region volume): an envelope in the clicked
 * region (Freestyle keeps those inside a region on the plug-in's own track).
 */
async function createLogicAutomation(laneId,option,{timeSec=0,beat=0,value=.5}={}){
 if(!engine.ready)return openCloudPanel();
 const kind=option.target?.kind,projectId=project.cloud?.projectId||project.id,bpm=Number(project.bpm)||120,barSec=(project.beatsPerBar||4)*60/bpm;automationStore.bind(projectId);
 const target=kind==='lane_volume'||kind==='lane_pan'?{kind,name:kind==='lane_pan'?'Pan':'Volume'}:option.spec?.target||option.target;
 if(!target?.kind)return toast(`${option.label}: Freestyle has no automation target for this parameter.`);
 // Logic: start point at the current value + the clicked point, which holds to the end (no trailing reset).
 // Disabelton (Live): the first click makes a FLAT envelope at the clicked value, with a breakpoint where you clicked.
 const flat=(at,duration)=>{const v=Math.max(0,Math.min(1,Number(value))),time=Math.max(0,Math.min(duration,Number(at)||0)),point=(t,val)=>({timeSec:t,value:val,curve:'linear',tension:0});return time>1e-6&&time<duration-1e-6?[point(0,v),point(time,v),point(duration,v)]:[point(0,v),point(duration,v)];};
 let envelope,points;
 if(kind==='lane_volume'||kind==='lane_pan'){
  const current=kind==='lane_pan'?lanePanValue(laneMixValue(laneId,'pan',0)):laneVolumeValue(laneMixValue(laneId,'gain',1)),durationSec=Math.max(logicProjectEndSec(),timeSec+barSec);
  envelope={clipId:`lane:${laneId}`,laneId:String(laneId),projectId,target,targetKey:automationTargetKey(target),valueType:'continuous',defaultValue:current,startSec:0,durationSec};points=flat(timeSec,durationSec,current);
 }else{
  const host=automationHostCandidates(project,laneId,{strictLane:target.kind==='plugin_parameter'}).find(clip=>beat>=clip.start&&beat<clip.start+clip.length);
  if(!host)return toast(`${option.label}: Freestyle keeps this automation inside a region on this track. Click inside a region.`);
  const durationSec=clipDurationSec(project,host),current=Number.isFinite(Number(option.spec?.defaultValue))?Number(option.spec.defaultValue):target.kind==='clip_gain'?.25:.5;
  envelope={clipId:automationClipId(host),projectId,target:structuredClone(target),targetKey:automationTargetKey(target),valueType:Array.isArray(target.options)&&target.options.length?'discrete':'continuous',defaultValue:current,durationSec};points=flat(Math.max(0,timeSec-host.start*60/bpm),durationSec,current);
 }
 clientLog('logic-automation-create-request',{projectId,laneId,targetKey:envelope.targetKey,timeSec,value});
 const result=await createAutomationEnvelope({store:automationStore,history:()=>engine.patternHistory,envelope,points,label:`Create ${option.label} Automation`,log:clientLog});
 paintAutomationClips();return result;
}
/** One automation-lane gesture = one guarded envelope save = one Undo step. */
async function commitLogicAutomation({envelope,points,label,span=null}){
 if(!engine.ready)throw new Error('Open the Freestyle cloud project before editing automation.');
 const result=await saveAutomationPointEdit({store:automationStore,history:()=>engine.patternHistory,envelope,points,span,label,log:clientLog});
 if(!result.unchanged&&result.recorded===false)clientLog('logic-automation-history',{recorded:false,label});return result;
}
// Shell/keys modules: X → toggleMixer(), A → toggleAutomationView(), Inspector → mountInspectorStrips(element,{getLaneId}).
window.disabelton=Object.assign(window.disabelton||{},{toggleMixer,toggleAutomationView,mountInspectorStrips,syncInspectorStrips,automationViewEnabled:()=>!!logicAutomation?.enabled,get logicAutomation(){return logicAutomationView();}});
export {toggleMixer,toggleAutomationView,mountInspectorStrips};
/* ---------- Disabelton devices lane (abl-devices.js): Device View, Drum Rack, Live mixers, Automation Mode ----------
 * Presentation lives in abl-dev-*.js / abl-mixer.js / abl-auto.js; every action below reuses the guarded paths above. */
var ablDevices=null;
/** Freestyle #3: the Main track (the master bus) has a real effect chain, shown in the Device View as laneId 'master'. */
const ABL_MAIN_ID='master';
function ablLaneRow(laneId){return laneId?currentMixerModel().rows.find(row=>laneId===ABL_MAIN_ID?row.kind==='bus'&&row.id===ABL_MAIN_ID:row.kind==='lane'&&row.id===laneId)||null:null;}
function ablRequireRow(laneId){const row=ablLaneRow(laneId);if(!row)throw new Error('That track is no longer in the mixer. Select it again.');return row;}
/** Live Mixer strips on another host: the same MixerStripView callbacks as the main Mixer, Live taper and decoration. */
function mountAblMixerStrips(element,{stripClass='abl-mixer-strip',idAttribute='ablMixer',onRendered=null,levelScale=null,formatLevel=null}={}){
 if(!element||!mixerStripViewOptions)throw new Error('The mixer is not ready.');
 const view=new MixerStripView({...mixerStripViewOptions,element,stripClass,idAttribute,...levelScale?{levelScale}:{},...formatLevel?{formatLevel}:{},onRendered:(host,rows)=>onRendered?.(host,rows),getSelectedKeys:null,onToggleMany:null,onInteraction:active=>{mixerStripViewOptions.onInteraction(active);if(!active)queueMicrotask(syncInspectorStrips);}});
 view.ablDecorate=()=>onRendered?.(element,currentMixerModel().rows);inspectorStripViews.add(view);view.render();
 return{view,render:()=>view.render(),destroy:()=>{inspectorStripViews.delete(view);view.destroy();}};
}
function ablDeviceChain(laneId){
 const row=ablLaneRow(laneId);if(!row)return null;const {plugins,state,cached}=logicRowPlugins(row),{instrument}=splitLogicChain(plugins,row.laneKind,{instrumentTypes:logicInstrumentTypes()});
 const own=plugins.map(plugin=>({...plugin,instrument:plugin===instrument})),hosted=instrument?null:ablHostedInstrument(laneId);
 if(row.kind==='bus')return{laneId,name:laneId===ABL_MAIN_ID?'Main':row.name||laneId,color:logicStripColor(row),laneKind:'bus',main:laneId===ABL_MAIN_ID,midi:false,plugins:plugins.map(plugin=>({...plugin,instrument:false})),cached,reading:!!state?.reading,busy:!engine.ready||!!state?.busy,error:state?.readError||state?.error||'',canAdd:!!engine.ready,rack:null};
 return{laneId,name:row.name||laneId,color:logicStripColor(row),laneKind:row.laneKind,midi:row.laneKind!=='audio'&&row.laneKind!=='vocal',plugins:hosted?[hosted,...own]:own,cached,reading:!!state?.reading,busy:!engine.ready||!!state?.busy,error:state?.readError||state?.error||'',canAdd:!!engine.ready,rack:ablDrumRack(laneId)};
}
/** Live keeps the instrument on the clip's track. A Freestyle pattern track whose notes play an instrument hosted on
 * another lane (rack instrument channel / note sourceId "plugin:<lane>") shows that real instance, tagged "on <track>". */
function ablHostedInstrument(laneId){
 const laneIds=project.cloud?.timelineLaneIds||[],patternIds=new Set((project.clips||[]).filter(clip=>clip.patternId&&laneIds[clip.track]===laneId).map(clip=>clip.patternId));if(!patternIds.size)return null;
 const hosts=new Set();
 for(const c of project.channels||[])if(c.patternSource&&patternIds.has(c.patternId)&&c.type==='instrument'&&c.laneId&&c.laneId!==laneId)hosts.add(c.laneId);
 if(!hosts.size)for(const pattern of project.patterns||[])if(patternIds.has(pattern.id))for(const event of pattern.cloudRaw?.pattern?.events/* real read (bd7040 Keys part) */||pattern.cloudSource?.pattern?.events||pattern.pattern?.events||[]){const source=String(event?.sourceId||'');if(source.startsWith('plugin:')&&source.slice(7)!==laneId)hosts.add(source.slice(7));}
 for(const hostId of hosts){const host=ablLaneRow(hostId);if(!host)continue;const {plugins:hostPlugins}=logicRowPlugins(host),{instrument}=splitLogicChain(hostPlugins,host.laneKind,{instrumentTypes:logicInstrumentTypes()});if(instrument)return{...instrument,instrument:true,hostLaneId:hostId,hostedOn:host.name||hostId};}
 return null;
}
/** Live's computer MIDI keyboard plays the SELECTED TRACK (Arrangement/Session header), not the selected pattern channel:
 * {kind:'instrument',channel} its own instrument or the one its pattern plays ("on Keys"), {kind:'drum',pads} Drum Rack
 * pads (C1 upwards), {kind:'audio'} / {kind:'empty'} nothing. null = no track selected (the caller keeps channel()). */
function ablKeyboardTarget(){
 const row=selectedTrackRow();if(row===null)return null;
 const laneId=project.cloud.timelineLaneIds[row],lane=project.channels.find(c=>c.id===laneId&&!c.patternSource)||project.channels.find(c=>!c.patternSource&&c.laneId===laneId),name=lane?.name||ablLaneRow(laneId)?.name||'Track',base={laneId,name};
 const chain=ablDeviceChain(laneId),kind=chain?.laneKind??lane?.type;
 if(kind==='audio'||kind==='vocal')return{...base,kind:'audio'};
 const instrument=(chain?.plugins||[]).find(plugin=>plugin.instrument),rack=chain?chain.rack:ablDrumRack(laneId);
 if(instrument&&!instrument.hostLaneId&&lane)return{...base,kind:'instrument',channel:lane};
 if(rack?.pads?.length)return{...base,kind:'drum',pads:rack.pads.map(pad=>pad.channelId)};
 if(instrument?.hostLaneId){const host=project.channels.find(c=>c.id===instrument.hostLaneId&&!c.patternSource)||project.channels.find(c=>c.type==='instrument'&&c.laneId===instrument.hostLaneId);if(host)return{...base,kind:'instrument',channel:host,hostedOn:instrument.hostedOn};}
 // A chain not read yet is not "no instrument": the lane's own channel is tried (the audition reports a real failure).
 if(lane?.type==='instrument'&&!(chain?.cached&&!instrument))return{...base,kind:'instrument',channel:lane};
 return{...base,kind:'empty'};
}
/** A step-sequenced track: its pattern placements play rack channels with samples → Live Drum Rack pads. */
function ablDrumRack(laneId){
 const laneIds=project.cloud?.timelineLaneIds||[],ids=[...new Set((project.clips||[]).filter(clip=>clip.patternId&&laneIds[clip.track]===laneId).map(clip=>clip.patternId))],patterns=ids.map(id=>project.patterns.find(item=>item.id===id)).filter(Boolean);
 const padsOf=p=>{const sources=Object.keys(p.cloudSources||{});return(sources.length?project.channels.filter(c=>sources.includes(c.id)):project.channels.filter(c=>c.patternSource&&c.patternId===p.id));};
 const racks=patterns.filter(p=>padsOf(p).some(c=>c.type==='sample'));if(!racks.length)return null;
 const shown=racks.find(p=>p.id===project.selectedPattern)||racks[0],channels=padsOf(shown);
 // QA r12: every row the Clip View's Fold shows is a pad — the rack rows bound in this pattern, sources first (their pad
 // numbering, C1 up), then the other bound rows in rack order (the grid showed only the 3 sources of a 7-row rack).
 if(shown.id===project.selectedPattern)for(const row of rackDisplayRows())if(row.channel&&!channels.includes(row.channel))channels.push(row.channel);
 return{patternId:shown.id,patternName:shown.name,patterns:racks.map(p=>({id:p.id,name:p.name})),editable:!!engine.ready/* QA r6: Live drops onto pads straight from the Device View; addPadSound/addPadInstrument target shown.id themselves */,selectedChannelId:channels.some(c=>c.id===selectedChannel)?selectedChannel:null,
  pads:channels.map(c=>({channelId:c.id,name:c.name,kind:c.type==='sample'?'sample':'plugin',mute:!!c.mute,solo:!!c.solo,color:channelColor(c.cloudSource?.color)||'',hasPlugin:!!channelPlugin(c),volume:Number.isFinite(Number(c.volume))?Number(c.volume):null,panLaneId:c.type!=='sample'&&c.laneId?c.laneId:null,pan:c.type!=='sample'&&c.laneId?ablLaneRow(c.laneId)?.values?.pan?.value??null:null}))};
}
/** Device View knob/plug-in loading: the plug-in window's path (cached inventory, saved slot, or a verified live slot), first page. */
async function ablLoadDeviceParameters(c,plugin){
 await pluginDialogIdle();await engine.flush();const controller=new MixerToolsController(scopedMixerOptions(c));
 if(!controller.isRestMode)await controller.refresh({readParameters:false});
 // A chain the app already confirmed (write receipt / its own read) is not read again; the page summary still verifies the slot.
 const confirmed=controller.isRestMode?logicRowPlugins(ablLaneRow(controller.target?.id)):null;
 if(!(confirmed?.cached&&controller.adoptConfirmedSlot(plugin,confirmed.plugins))&&(controller.hasFreshInventory()||!controller.adoptSavedSlot(plugin)))await controller.ensurePlugin(plugin,{cached:true});
 await controller.readPlugin(plugin.index);return controller;
}
/** The Browser's cached catalog of this project as a MixerToolsController lane catalog, when it resolves `ref`; else null. */
function ablCachedCatalog(ref){
 let source=null;try{source=window.ablDevices?.catalog||null;}catch{return null;}
 if(!source||String(source.scope??'')!==String(engine.projectId??'')||!Array.isArray(source.entries))return null;
 const lower=value=>String(value??'').toLowerCase(),key=ref&&typeof ref==='object'?ref:{id:String(ref??'')};
 const entries=source.entries.filter(entry=>entry?.kind==='effect'&&['native','vst3'].includes(entry.format));
 const hit=entries.find(entry=>key.id&&entry.id===key.id)||entries.find(entry=>key.type&&lower(entry.id)===lower(key.type))||entries.find(entry=>key.name&&lower(entry.name)===lower(key.name));
 if(!hit)return null;
 return entries.map(entry=>({id:entry.id,name:entry.name,kind:'effect',format:entry.format,category:entry.category,availability:{checked:entry.checked,installed:entry.installed},hostGated:!!entry.hostGated}));
}
/* Freestyle #20: an instrument dropped / double-clicked onto a MIDI track that already plays one replaces it in place
   (replaceLaneInstrument, If-Match = timeline revision): patterns, notes, effects, sends and mix are kept. One Undo step:
   Undo sends the reply's `undo` request (the previous instrument with its exact saved state), Redo replaces again. */
function ablOwnInstrument(laneId){const chain=ablDeviceChain(laneId);return(chain?.plugins||[]).find(plugin=>plugin.instrument&&!plugin.hostLaneId)||null;}
async function ablInstrumentCatalogEntry(ref){
 const lower=value=>String(value??'').toLowerCase(),catalog=await emptyInstrument.catalog();
 return(catalog||[]).find(row=>[ref.id,ref.type].some(value=>value&&lower(row.id)===lower(value)))||(catalog||[]).find(row=>ref.name&&lower(row.name)===lower(ref.name))||null;
}
async function ablReplaceInstrument(laneId,ref){
 const client=ablStudioClient();if(!client)throw new Error('Replacing an instrument needs the Freestyle Studio API connection.');
 const row=ablRequireRow(laneId),entry=await ablInstrumentCatalogEntry(ref);
 if(!entry)throw new Error(`${ref.name||ref.id||ref.type} is not in Freestyle’s instrument catalog.`);if(entry.creatable===false)throw new Error(`${entry.name} cannot be loaded on this Freestyle host.`);
 await engine.flush();const projectId=engine.projectId,scope=engine.patternHistory?.context?.(),label=`Replace ${row.name||'track'} instrument with ${entry.name}`;
 const ifMatch=()=>{const raw=engine.session.rawProject||{};return raw._studioApi?.etag||JSON.stringify(raw.timelineRevision);};
 const send=async(body,what)=>{const started=performance.now();const reply=await client.call('replaceLaneInstrument',{path:{project_id:projectId,lane_id:laneId},body},{ifMatch:ifMatch()});const data=reply?.data||{};clientLog('abl-instrument-replace',{laneId,what,ms:Math.round(performance.now()-started),replaced:data.replaced??null,from:data.previousInstrument?.id??null,to:data.instrument?.id??null,stateRestored:data.stateRestored??null});
  const key=mixerFxKey(row);mixerFxStates.delete(key);await engine.refresh();renderAll();ablDevices?.api.sync();return data;};
 toast(`Loading ${entry.name} on ${row.name||'the track'}…`);
 const first=await send({instrument_id:entry.id},'replace');
 if(first.replaced===false){toast(`${row.name||'The track'} already plays ${entry.name}.`);return first;}
 let undoBody=first.undo?.body||null;const redoBody={instrument_id:entry.id};
 if(undoBody&&engine.patternHistory?.recordExternalStep)engine.patternHistory.recordExternalStep({kind:'instrument_replace',label,scope,detail:{laneId,from:first.previousInstrument?.id??null,to:entry.id},
  undo:async()=>{if(!undoBody)throw new Error('Freestyle returned no way back to the previous instrument.');const data=await send(undoBody,'undo');return{laneId,instrument:data.instrument?.id??null};},
  redo:async()=>{const data=await send(redoBody,'redo');if(data.undo?.body)undoBody=data.undo.body;return{laneId,instrument:data.instrument?.id??null};}});
 toast(`${entry.name} replaced ${first.previousInstrument?.name||'the instrument'} on ${row.name||'the track'}.${undoBody?' ⌘Z puts it back.':''}`);
 return first;
}
async function ablAddPlugin(laneId,ref){
 if(!engine.ready)return openCloudPanel();
 if((ref?.kind==='instrument'||ref?.category==='instruments')&&ablLaneRow(laneId)?.laneKind==='instrument'&&ablOwnInstrument(laneId))return ablReplaceInstrument(laneId,ref);
 const row=ablRequireRow(laneId),c=mixerRowChannel(row),controller=new MixerToolsController(scopedMixerOptions(c));
 // QA r9: a Browser drop waited ~0.9 s for a full catalog read before the add. The Browser already lists the paged
 // catalog of this project (window.ablDevices.catalog, read with project_id = host availability): a ref it resolves is
 // added from that cache at once; only a ref it cannot resolve reads the catalog.
 const cached=controller.isRestMode&&row.kind==='lane'?ablCachedCatalog(ref):null;
 if(cached){controller.catalog=cached;controller.catalogLoaded=true;}else await controller.readCatalog({checkHost:true,cached:true});
 const id=item=>controller.isRestMode?item.id:item.path,lower=value=>String(value??'').toLowerCase();
 const entry=(controller.catalog||[]).find(item=>ref.id&&(id(item)===ref.id||item.id===ref.id||item.path===ref.id))||(controller.catalog||[]).find(item=>ref.type&&[item.type,item.type_id,item.typeId].some(value=>lower(value)===lower(ref.type)))||(controller.catalog||[]).find(item=>ref.name&&lower(item.name||item.label)===lower(ref.name));
 if(!entry)throw new Error(`${ref.name||ref.id||ref.type} is not in the Freestyle plug-in catalog.`);if(entry.hostGated)throw new Error(`${entry.name||ref.name} is not installed on this Freestyle host.`);
 return insertLogicPlugin(row,c,controller,{id:id(entry),name:entry.name||entry.label||id(entry)},{openWindow:false});
}
function ablPadAudition(channelId){
 const c=project.channels.find(item=>item.id===channelId);if(!c)return null;const raw=c.cloudSource||{},sample=c.type==='sample'||raw.kind==='sample'||!!raw.audioFileId;
 // Studio Pro's drum pads send `sample_preview` over the ordered mozart-control channel ("drumpad-pad-realtime"), with the
 // HTTP preview only as fallback. Same here: the channel when the peer is up with a write grant, else the REST preview.
 if(sample){const audioFileId=raw.audioFileId||raw.audio_file_id||c.audioFileId;let route='rest';
  if(audioFileId&&engine.monitor?.channelWritesAllowed?.())try{engine.monitor.sendControl({type:'sample_preview',audio_file_id:String(audioFileId),bus_id:String(raw.busId||raw.bus_id||'master'),duration_sec:0,gain:Math.min(2,Math.max(0,Number(c.volume??raw.volume??1)||0)),playback_rate:1});route='channel';}catch{route='rest';}
  /* Owner bug 6: a pad clicked while the monitor peer is still opening (the first seconds after a project opens) used to
     wait for the peer and then take the slow REST preview (+~0.9 s). It now waits for the peer and sends the same
     sample_preview on the control channel the moment it opens; REST stays the fallback. */
  if(route==='rest'&&audioFileId&&engine.monitor?.channelWritesAllowed?.()&&engine.monitor.control?.readyState!=='open'&&typeof engine.ensureMonitorReady==='function'){route='channel-pending';const projectId=engine.projectId,since=performance.now();
   Promise.resolve(engine.ensureMonitorReady()).then(async()=>{/* the control channel opens a few ms after the peer reports connected */for(let tries=0;tries<40&&engine.monitor.control?.readyState==='connecting';tries++)await new Promise(resolve=>setTimeout(resolve,15));if(engine.projectId!==projectId)return;if(engine.sampleAudition?.play?.(c)===false)return engine.preview(c,60);clientLog('abl-pad-audition',{channelId,route:'channel-after-connect',waitMs:Math.round(performance.now()-since)});}).catch(()=>engine.preview(c,60).catch(fail));}
  else if(route==='rest')engine.preview(c,60).catch(fail);clientLog('abl-pad-audition',{channelId,route});return{stop(){},route};}
 let lease=null;const since=performance.now();try{lease=engine.acquireInstrumentNote(c,60,.8);Promise.resolve(lease.ready).catch(fail);}catch(error){fail(error);return null;}
 const cap=setTimeout(()=>{try{lease?.release();}catch{}lease=null;},PIANO_PREVIEW_MAX_MS);
 return{stop(){clearTimeout(cap);const held=lease;lease=null;const wait=PIANO_PREVIEW_MIN_MS-(performance.now()-since);setTimeout(()=>{try{held?.release();}catch(error){fail(error);}},Math.max(0,wait));}};
}
/** Drum Rack: an instrument dropped on a pad becomes a rack channel through the rack's channel-add path (one Undo step).
 * Freestyle rack instrument channels play an instrument that lives on a track, so the ref must match one of this project's instruments. */
function ablAddPadInstrument(ref,patternId,slot=null){
 const lower=value=>String(value??'').toLowerCase(),pads=project.channels.filter(c=>c.patternId===patternId),anchor=pads.find(c=>channelOpsReady(c));
 if(!anchor)throw new Error('Open this track’s pattern (saved in Freestyle) before adding pads.');
 const match=insertableChannels().filter(item=>item.channel.kind==='plugin').find(item=>{const owner=project.channels.find(c=>c.type==='instrument'&&c.laneId===item.channel.laneId),plugin=owner?channelPlugin(owner):null;return(ref.laneId&&ref.laneId===item.channel.laneId)||(ref.name&&lower(ref.name)===lower(item.label))||[ref.type,ref.id].some(value=>value&&plugin&&[plugin.type_id,plugin.type,plugin.id].some(own=>lower(own)===lower(value)));});
 if(!match)return ablAddPadNewInstrument(ref,patternId,anchor,slot);
 const sources=savedPatternSources(patternId)||[],position=Number.isInteger(slot)&&slot<sources.length?slot:undefined;
 return rackChannelEdit(anchor,ops=>ops.add(patternId,match.channel,{position,label:`Add ${match.label} pad`}));
}
/** Live loads a new instrument straight into the pad. Freestyle rack instrument channels play a track's instrument, so this
 * creates the instrument track (the REST instrument-lane create, as the lane-create dialog does) and adds the pad channel for it,
 * then records the pair as ONE Undo step: Undo deletes the channel, then the track; Redo recreates the track, then the channel.
 * Each half runs its own guarded, confirmed path; their history steps are captured instead of recorded separately. */
async function ablAddPadNewInstrument(ref,patternId,anchor,slot=null){
 requireUiFeature('create_instrument');const lower=value=>String(value??'').toLowerCase(),catalog=await emptyInstrument.catalog();
 const entry=(catalog||[]).find(row=>[ref.id,ref.type].some(value=>value&&lower(row.id)===lower(value)))||(catalog||[]).find(row=>ref.name&&lower(row.name)===lower(ref.name));
 if(!entry)throw new Error(`${ref.name||ref.id||ref.type} is not in Freestyle’s instrument catalog.`);if(entry.creatable===false)throw new Error(`${entry.name} cannot be created on this Freestyle host.`);
 const name=ref.name||entry.name,label=`Add ${name} pad`,scope=engine.patternHistory.context();let lane=null,channel=null;
 const laneHistory={beginLaneCreate:controller=>({controller}),finishLaneCreate:token=>{lane=token.controller;},failLaneCreate:()=>{}};
 const receipt=await createLaneWithHistory({type:entry.id,name},{instrument:true,history:laneHistory});const laneId=receipt?.laneId??receipt?.lane?.id;
 if(!lane||!laneId)throw new Error(`${name}’s track is saved, but its history is unconfirmed. Inspect tracks before adding the pad again.`);
 await engine.refresh();
 const channelHistory={beginExternalStep:()=>({}),finishExternalStep:(token,step)=>{channel=step;},failExternalStep:()=>{}};
 const ops=new PatternChannelOps({getScope:fileImportScope,read:readChannelRack,adopt:adoptChannelReceipt,revision:()=>engine.session.rawProject?.timelineRevision,savedSources:savedPatternSources,history:channelHistory,flush:()=>engine.flush()});
 const sources=savedPatternSources(patternId)||[],position=Number.isInteger(slot)&&slot<sources.length?slot:undefined;
 const laneStep=async direction=>{const before=await lane.fresh();lane.freshBefore=before;await lane[direction]();await engine.refresh();};
 try{await ops.add(patternId,{kind:'plugin',name,laneId},{position,label});}
 catch(error){
  // Never leave an orphan track outside history: undo the captured track creation, so the project is exactly as before.
  let rolledBack=false;try{await laneStep('undo');rolledBack=true;}catch(rollback){clientLog('abl-pad-instrument-rollback-failed',{laneId,message:String(rollback?.message||rollback).slice(0,160)});}
  renderAll();clientLog('abl-pad-instrument-rollback',{laneId,rolledBack});
  error.message=rolledBack?`Not saved: ${name} could not be added as a pad (${error.message}). Its new track was removed again.`:`Not saved: ${name}’s pad was not added (${error.message}), and removing its new track failed. Inspect tracks.`;throw error;
 }
 engine.patternHistory.recordExternalStep({kind:'rack_channel',label,scope,detail:{patternId,laneId},
  undo:async()=>{await channel.undo();await laneStep('undo');renderAll();return{laneId};},redo:async()=>{await laneStep('redo');await channel.redo();renderAll();return{laneId};}});
 renderAll();return receipt;
}
function ablSelectPad(channelId){const rowId=rackRowForChannel(channelId);selectedChannel=channelId;selectedRackRow=rowId;try{rackSelector?.selection?.focus(rowId);}catch{}renderRack();renderPiano();}
function ablParameterMenu(event,laneId,plugin,parameter){
 const spec=pluginParameterAutomation({target:{kind:'lane',id:laneId}},plugin,parameter),key=spec?`lane.plugin:${spec.target.pluginInstanceId}.param:${spec.target.stableParamId}`:null;
 menu(event,[{label:'Show Automation',disabled:!spec,title:spec?'':'This parameter is not automatable in Freestyle.',run:()=>{const view=logicAutomationView(),row=ablLaneRow(laneId);const show=()=>{view.devices.set(String(laneId),spec.target.pluginInstanceId);view.setParameter(laneId,key);toggleAutomationView(true);};if(row&&!logicPluginParams.has(`${engine.projectId}|${laneId}|${spec.target.pluginInstanceId}`))return loadLogicPluginParameters(row,plugin).then(show);show();}},null,automationMenuItem(spec)]);
}
function ablAutomationDevices(laneId){const row=ablLaneRow(laneId);if(!row)return[];return logicRowPlugins(row).plugins.filter(plugin=>String(plugin.type_id??plugin.type??'')!=='native-eq').map(plugin=>({key:String(plugin.instance_id??plugin.instanceId??plugin.id),label:logicPluginName(plugin)}));}
/** Automation Mode's flat line before the first breakpoint: the control's current value on the envelope's 0..1 scale
 * (lane volume = gain/4 as formatAutomationValue reads it, pan = (pan+1)/2, a plug-in parameter its read normalized value). */
function ablAutomationCurrentValue(laneId,option){
 const kind=option?.target?.kind,values=ablLaneRow(laneId)?.values;
 if(kind==='lane_volume'){const state=values?.gain;return state?.known===false||!Number.isFinite(Number(state?.value))?null:Math.max(0,Math.min(1,Number(state.value)/4));}
 if(kind==='lane_pan'){const state=values?.pan;return state?.known===false||!Number.isFinite(Number(state?.value))?null:Math.max(0,Math.min(1,(Number(state.value)+1)/2));}
 return Number.isFinite(Number(option?.spec?.defaultValue))?Number(option.spec.defaultValue):null;
}
function ablLoadAutomationDevice(laneId,instanceId){const row=ablRequireRow(laneId),plugin=logicRowPlugins(row).plugins.find(item=>String(item.instance_id??item.instanceId??item.id)===instanceId);if(!plugin)throw new Error('That device is no longer on this track.');return loadLogicPluginParameters(row,plugin);}
function ablArmState(laneId){const tools=window.vegetableStudio?.regionTools,kind=ablLaneRow(laneId)?.laneKind,recordable=RECORD_LANE_KINDS.has(kind)||MIDI_RECORD_LANE_KINDS.has(kind),recording=!!(engine.recorder?.recording||engine.recordingContext||ablMidiTake.active);return{available:!!tools&&recordable&&!recording,armed:tools?.recordState?.armed===laneId,midi:MIDI_RECORD_LANE_KINDS.has(kind),reason:!recordable?'Arm Recording: this track cannot record':recording?'Arm Recording: wait until the current take is saved':''};}
function ablToggleArm(laneId){const tools=window.vegetableStudio?.regionTools,state=ablArmState(laneId);if(!tools||!state.available)throw new Error(state.reason||'Arm Recording is unavailable.');const next=tools.recordState.armed===laneId?null:laneId;if(tools.arm)tools.arm(next,ablLaneRow(laneId)?.laneKind);else tools.recordState.armed=next;tools.paintTrackRecord?.();toast(tools.recordState.armed?`Armed: ${ablLaneRow(laneId)?.name||'track'}`:'Arm off');}
queueMicrotask(()=>{try{ablDevices=installAblDevices({document,menu,toast,fail,log:clientLog,ready:()=>!!engine.ready&&!!mixerStripViewOptions,projectId:()=>engine.ready?`${engine.projectId}|${engine.loadVersion||0}`:null,
 selectedLaneId:()=>{const row=currentMixerRow();return row?.kind==='lane'?row.id:row?.kind==='bus'&&row.id===ABL_MAIN_ID&&selectedMixerKey===row.key?ABL_MAIN_ID:null;},selectLane:laneId=>{selectedMixerKey=laneId===ABL_MAIN_ID?mixerRowKey('bus',ABL_MAIN_ID):mixerRowKey('lane',laneId);mixerChannel=laneId;renderMixer();},
 deviceChain:ablDeviceChain,channelFor:laneId=>mixerRowChannel(ablRequireRow(laneId)),
 requestChainRead:laneId=>{const row=ablLaneRow(laneId);if(row&&!logicRowPlugins(row).cached)return readMixerFxSlots(mixerRowChannel(row),row,JSON.stringify(mixerScope()),{device:true});},
 toggleBypass:(laneId,plugin)=>{const row=ablRequireRow(laneId);return bypassEffectSlot(logicRowPlugins(row).c,plugin,row,JSON.stringify(mixerScope()),project);},
 openPluginWindow:(laneId,plugin,{configure=false}={})=>{const row=ablRequireRow(laneId);return pluginDialog(logicRowPlugins(row).c,plugin,{nativeFirst:true,configure});},
 removePlugin:(laneId,plugin)=>{const row=ablRequireRow(laneId);return editEffectSlot(logicRowPlugins(row).c,plugin,row,JSON.stringify(mixerScope()),project,async(controller,current)=>{await controller.remove(current);return `${logicPluginName(plugin)} deleted from ${row.name||'the track'}.`;});},
 movePlugin:(laneId,plugin,to)=>{const row=ablRequireRow(laneId);return editEffectSlot(logicRowPlugins(row).c,plugin,row,JSON.stringify(mixerScope()),project,async(controller,current)=>{await controller.move(current,to);return `${logicPluginName(plugin)} moved.`;});},
 openAddMenu:(laneId,event,rect)=>addLogicPlugin(ablRequireRow(laneId),event,rect),addPlugin:ablAddPlugin,catalogScope:()=>engine.ready?engine.projectId:'',readCatalogPage:({cursor,limit})=>{const row=currentMixerModel().rows.find(item=>item.kind==='lane');if(!engine.ready||!row)throw new Error('Open a Freestyle cloud project first.');return new MixerToolsController(scopedMixerOptions(mixerRowChannel(row))).call('list_plugin_catalog',{project_id:engine.projectId,limit,include_presets:true,...cursor?{cursor}:{}});},
 loadParameters:ablLoadDeviceParameters,recordParameterStep:packet=>recordPluginParameterHistory(packet),historyScope:()=>engine.patternHistory?.context?.(),idle:pluginDialogIdle,quiet:()=>!workspaceBusy()&&!engine.patternHistory?.reserved?.length&&!engine.loading&&!engine.applying,gestureActive:()=>!!engine.interacting||!!document.querySelector('#piano-keys[data-audition-state="active"],#piano-keys[data-audition-state="connecting"],[data-audition-state="active"],[data-audition-state="connecting"]'),
 // Freestyle now pushes a fresh editor frame after every parameter write, so an open plug-in window repaints by itself.
 refreshGui:()=>{},parameterMenu:ablParameterMenu,
 mountLaneEq:(element,laneId)=>{const row=ablLaneRow(laneId);if(!row||row.kind!=='lane'||!restMixer?.isRestMode||!eqSupported(STUDIO_API_OPERATIONS))return null;const c=mixerRowChannel(row),options=scopedMixerOptions(c),section=mountAblEqEight({projectId:engine.projectId,laneId,trackId:engine.session.trackId??null,laneName:row.name||'Track',fetch:options.fetch,historyFetch:()=>scopedMixerOptions(c,{historyStep:true}).fetch,history:engine.patternHistory,historyScope:()=>engine.patternHistory?.context?.(),log:clientLog,onError:fail,idle:pluginDialogIdle});element.append(section.element);return section;},
 selectPad:ablSelectPad,auditionPad:ablPadAudition,padMenu:(event,channelId)=>channelMenu(event,channelId),renamePad:(channelId,name)=>{const c=project.channels.find(item=>item.id===channelId);if(!c)return;return channelOpsReady(c)?updateRackChannel(c,{name},'Rename'):edit(()=>c.name=name);},removePad:channelId=>{const c=project.channels.find(item=>item.id===channelId);if(!c)return;if(project.channels.length===1)return toast('A project keeps at least one channel.');return channelOpsReady(c)?rackChannelEdit(c,ops=>ops.remove(c.patternId,c.sourceId,{label:`Delete ${c.name}`})):deleteChannelConfirm(c);},addPadInstrument:(ref,patternId,slot)=>ablAddPadInstrument(ref,patternId,slot),setPadVolume:(channelId,value)=>{const c=project.channels.find(item=>item.id===channelId);if(!c)return;return channelOpsReady(c)?updateRackChannel(c,{volume:value},'Volume'):edit(()=>c.volume=value);},setPadPan:(laneId,before,value)=>{const row=ablRequireRow(laneId);return mixerControl({row,before,value,scope:mixerScope()},'pan');},openPadPlugin:channelId=>togglePluginWindow(channelId),selectPattern:id=>selectPattern(id),
 togglePadMute:channelId=>{const c=project.channels.find(item=>item.id===channelId);if(c)edit(()=>c.mute=!c.mute);},togglePadSolo:channelId=>{const c=project.channels.find(item=>item.id===channelId);if(c)edit(()=>c.solo=!c.solo);},
 addPadSound:(raw,patternId)=>{const item=JSON.parse(raw);if(item?._libraryView==='rack-channel')return;if(!item?.id||!cloudLibrary)throw new Error('Choose a sound returned by the cloud library.');if(patternId&&project.selectedPattern!==patternId)selectPattern(patternId);return cloudLibrary.execute(()=>cloudLibrary.addSound(item));},
 mountStrips:mountAblMixerStrips,trackColor:row=>logicStripColor(row),armState:ablArmState,toggleArm:ablToggleArm,selectTrackLane:laneId=>{const row=(project.cloud?.timelineLaneIds||[]).indexOf(laneId);if(row>=0)window.vegetableStudio?.ablShell?.selectTrack?.(row);},
 toggleAutomation:force=>toggleAutomationView(force),automationView:()=>logicAutomationView()});window.vegetableStudio.ablDevices=ablDevices;}catch(error){clientLog('abl-devices-install-error',{message:String(error?.message||error).slice(0,200)});}});

function mixerChannelTarget(c){if(c?.patternSource){const model=currentMixerModel(),row=c.laneId?model.rows.find(row=>row.kind==='lane'&&row.id===c.laneId):model.rows.find(row=>row.kind==='bus'&&row.id===c.cloudSource?.busId);if(!row)throw new Error('Select an existing lane or bus in the Mixer to edit its effects.');return mixerRowChannel(row);}const target=c||mixerRowChannel(currentMixerRow());if(!target)throw new Error('Select a persisted mixer lane or bus first.');return target;}
function scopedMixerOptions(c,{historyStep=false}={}){
 const current=project,projectId=current.cloud?.projectId||current.id,trackId=current.cloud?.trackId,version=engine.loadVersion;
 // A history Undo/Redo step runs while the journal is busy by design; every other guard stays.
 // assertCurrent: the open project only (displaying loaded controls); assertScope adds the idle-workspace guard for reads/writes.
 const assertCurrent=()=>{if(!engine.ready||engine.loading||engine.loadVersion!==version||engine.projectId!==projectId||engine.session.projectId!==projectId||engine.session.trackId!==trackId)throw new Error('The cloud project changed. Reopen its plugin controls before editing.');},assertScope=()=>{assertRangeIdle({ignorePatternHistory:historyStep});assertCurrent();};
 const guarded=async task=>{assertScope();const result=await task();assertScope();return result;};
 assertScope();return{project:current,channel:mixerChannelTarget(c),assertScope,assertCurrent,...(historyStep?{onChainChanged:detail=>rereadMixerFx(detail)}:{chainPreview:previewMixerChain,history:engine.patternHistory,historyController:()=>new MixerToolsController(scopedMixerOptions(c,{historyStep:true}))}),inventory:{cache:pluginInventory,scope:()=>({projectId,trackId,loadVersion:version})},liveLaneIds:()=>{const mix=mixRevision?.projectId===projectId?mixRevision.mix:null;return Array.isArray(mix?.tracks)?new Set(mix.tracks.map(track=>track?.db_track_id).filter(id=>typeof id==='string'&&id)):null;},liveControl:engine.liveControl,call:(name,args,options)=>guarded(()=>engine.session.call(name,args,options)),fetch:(...args)=>guarded(()=>hostFetch(...args)),onChanged:()=>guarded(()=>engine.refresh()),onRoute:({laneId})=>{assertScope();return mixerRoutingDialog.open({laneId});},onError:fail};
}
async function openSelectedMixerTools(c=mixerRowChannel(currentMixerRow()),{initialTab='slots',replacePlugin=null,copySourceId=null}={}){if(!engine.ready)return openCloudPanel();const options=scopedMixerOptions(c);await engine.flush();options.assertScope();return openMixerTools({...options,initialTab,...replacePlugin?{replacePlugin}:{},...copySourceId?{copySourceId}:{}});}
/* Logic Copy / Paste Channel Strip Setting: Freestyle's effects-chain copy (copyLaneEffectChain), reviewed in a Paste Channel Strip Setting sheet before saving. */
async function openPasteChannelStrip(c,copySourceId){if(!engine.ready)return openCloudPanel();const options=scopedMixerOptions(c);await engine.flush();options.assertScope();return openPasteChannelStripSheet({...options,copySourceId,onPasted:receipt=>toast(`Pasted the channel strip setting onto ${receipt.review?.destinationName||'the track'}.`)});}
let copiedChannelStrip=null;
function channelStripSettingEntries(laneId){
 const lane=(project.cloud?.rawProject?.lanes||[]).find(item=>item.id===laneId)||null,row=laneId?currentMixerModel().rows.find(item=>item.kind==='lane'&&item.id===laneId):null,c=row?mixerRowChannel(row):null;
 const run={'copy-strip':()=>{copiedChannelStrip={projectId:engine.projectId,laneId,name:lane?.name||laneId};toast(`Copied ${lane?.name||'the track'}’s channel strip setting (effects chain).`);},'paste-strip':()=>{if(!c)throw new Error('Open the Mixer (X) to paste onto this track.');return openPasteChannelStrip(c,copiedChannelStrip?.laneId);}};
 return channelStripSettingItems({projectId:engine.projectId,laneId,laneKind:lane?.kind||null,name:lane?.name||'',copied:copiedChannelStrip,ready:engine.ready&&!engine.loading}).map(item=>({...item,run:run[item.id]}));
}
function channelStripSettingMenu(laneId,event){menu(event,channelStripSettingEntries(laneId));}
/** Plug-in slots with no engine editor target: Freestyle's built-in (native) effects, and lane instances whose GUI open
 * the engine answered with 409 target_not_loaded (this session). Their windows show the built-in parameter editor. */
const pluginGuiNotLoaded=new Set();
const pluginGuiKey=(c,plugin)=>{const instance=plugin?.instance_id??plugin?.instanceId??plugin?.id;return c?.laneId&&typeof instance==='string'?`${engine.projectId}:${c.laneId}:${instance}`:null;};
/** Freestyle #6: listLanePlugins / catalog rows say hasEditor; false = no GUI (native effects): parameters only, no editor request. */
function pluginIsBuiltIn(plugin){const has=plugin?.hasEditor??plugin?.has_editor;if(has===false)return true;if(has===true)return false;const format=String(plugin?.format??'').toLowerCase(),type=String(plugin?.type_id??plugin?.typeId??plugin?.type??'').toLowerCase();return format==='native'||/^native[-_]/.test(type);}
function pluginGuiUnavailable(c,plugin){if(pluginIsBuiltIn(plugin))return true;const key=pluginGuiKey(c,plugin);return !!key&&pluginGuiNotLoaded.has(key);}
function markPluginGuiUnavailable(c,plugin){const key=pluginGuiKey(c,plugin);if(key)pluginGuiNotLoaded.add(key);}
async function pluginDialog(c,plugin,{nativeFirst=false,configure=false}={}){
 if(!engine.ready)return openCloudPanel();
 if(!Number.isInteger(plugin?.index)||plugin.index<0)throw new Error('Select a plugin with a live slot index.');
 const options=scopedMixerOptions(c),controller=new MixerToolsController(options),editorController=new MixerToolsController(options),d=dialog(`${plugin.name||'Plugin'} (${c?.name||'Master'})`, '<p class="plugin-loading">Loading parameters from Freestyle…</p>',{modeless:true,className:'plugin-parameter-dialog'});d.dataset.pluginChannel=c?.id||'';
 // The window belongs to this exact instance: a chain read without it closes the window (and its GUI polling).
 {const instance=plugin.instance_id??plugin.instanceId??plugin.id;if(controller.target.kind==='lane')registerPluginWindow({dialog:d,projectId:controller.projectId,laneId:controller.target.id,instanceId:typeof instance==='string'?instance:null,refresh:()=>{remoteEditor?.refresh?.({fresh:true});},onStale:info=>{remoteEditor?.targetRemoved?.(info?.reason||'removed');toast(`${plugin.name||'Plugin'} is no longer on ${c?.name||'this track'}; its window was closed.`);}});}
 // A 409 target_not_loaded on a slot/frame here usually means this instance was removed: re-read the chain (closing the window if so).
 const verifyInstance=async fallback=>{try{await controller.refreshPlugins();}catch{}if(d.isConnected&&d.open&&fallback)fallback();};
 let remoteEditor;d.addEventListener('close',()=>remoteEditor?.close().catch(()=>{}),{once:true});
 const assertActive=()=>{options.assertScope();if(!d.isConnected||!d.open)throw new Error('This plugin dialog is closed.');};
 // The GUI mirror only needs the same project and an open window; a running Undo/Redo is not a reason to stop it
 // (its input waits for the step instead: pluginDialogIdle).
 const assertGuiCurrent=()=>{options.assertCurrent();if(!d.isConnected||!d.open)throw new Error('This plugin dialog is closed.');};
 // Mount independent editor actions before any parameter discovery can await.
  const content=d.querySelector('.dialog-content');
  // FL plugin window: native GUI tab (remote editor mirror) with the typed parameter page as a tab/fallback.
  content.innerHTML='<div class="plugin-window-tabs" role="tablist"><button type="button" role="tab" data-plugin-tab="gui">Plugin GUI</button><button type="button" role="tab" data-plugin-tab="parameters">Parameters</button></div><div class="plugin-gui-panel" role="tabpanel"><button class="primary plugin-original-gui">Open original cloud plugin GUI</button></div><div class="plugin-parameter-panel" role="tabpanel"><button class="plugin-slots">Slots, bypass and routing</button><div class="plugin-parameter-toolbar"><p class="plugin-parameter-count" role="status"></p><button class="plugin-parameter-more">Load more parameters</button><button class="plugin-parameter-inspect">Inspect parameter values</button></div><p class="plugin-parameter-status" role="status"></p><div class="plugin-parameter-page"></div></div>';
  const showPluginTab=name=>{d.dataset.pluginTab=name;content.querySelector('.plugin-gui-panel').hidden=name!=='gui';content.querySelector('.plugin-parameter-panel').hidden=name!=='parameters';{const eq=content.querySelector('.plugin-eq-panel');if(eq)eq.hidden=name!=='eq';}for(const tab of content.querySelectorAll('[data-plugin-tab]')){const on=tab.dataset.pluginTab===name;tab.classList.toggle('selected',on);tab.setAttribute('aria-selected',String(on));}remoteEditor?.resume?.();};showPluginTab(nativeFirst?'gui':'parameters');
  // Native EQ slot: FL Parametric EQ 2-style typed band editor (getLaneEq / setLaneEqBand).
  const eqTab=mountPluginEqTab({dialog:d,content,controller,plugin,channel:c,fetch:options.fetch,historyFetch:()=>scopedMixerOptions(c,{historyStep:true}).fetch,history:engine.patternHistory,historyScope:()=>engine.patternHistory?.context?.(),onError:fail,log:clientLog});if(eqTab)showPluginTab('eq');
  // Logic plug-in window chrome (title = track, power/Setting/Compare/Copy/View, Controls|Editor); panels and input are unchanged.
  mountAblPluginHeader(d,content,{trackName:c?.name||'Main',pluginName:logicPluginName(plugin),tabs:{show:showPluginTab,current:()=>d.dataset.pluginTab},hasTab:name=>name==='eq'?!!content.querySelector('.plugin-eq-panel'):true,bypass:logicPluginBypass(c,plugin),menu,settingItems:()=>[{label:'Copy effects chain…',title:'Copy this track’s whole effect chain to another track',run:()=>{d.close();return openSelectedMixerTools(c);}},{label:'Slots, bypass and routing…',run:()=>{d.close();return openSelectedMixerTools(c);}}],onError:fail});
  content.querySelector('.plugin-parameter-page').oncontextmenu=event=>{const row=event.target.closest?.('[data-parameter-row]');if(!row)return;event.preventDefault();event.stopPropagation();const parameter=controller.parameters.find(item=>item.index===Number(row.dataset.parameterRow));menu(event,parameterMenuItems(parameter));};
  // FL knob right-click: Reset, Type in value, Copy/Paste value, Create automation clip.
  const parameterMenuItems=parameter=>{
   const control=parameter&&controller.parameterControl(parameter),locked=!control||parameterBusy||parameter.stale===true,physical=control?.form==='physical';
   const current=()=>{const held=controller.parameterWriteValue(parameter.index);return held!==undefined?held:control?.value;};
   const clamp=value=>Math.min(control.max,Math.max(control.min,value)),apply=value=>{if(!Number.isFinite(value))throw new Error('Enter a finite value.');return writeParameter(parameter.index,clamp(value));};
   const reset=physical?parameter.physicalDefault:parameter.default,hasReset=Number.isFinite(Number(reset))&&reset!==null;
   const unit=physical?(control?.unit||parameter.unit||''):'%',toShown=value=>physical?value:Math.round(value*1000)/10,fromShown=value=>physical?value:value/100;
   return[['Reset','',()=>apply(Number(reset)),locked||!hasReset],['Type in value…',unit,()=>textDialog(`${plugin.name||'Plugin'} · ${parameter.name}`,`${parameter.name}${unit?` (${unit})`:''}`,String(toShown(current())),text=>{Promise.resolve().then(()=>apply(fromShown(Number(text)))).catch(fail);}),locked],...valueClipboardItems(physical?`physical:${control?.unit||''}`:'normalized',current,value=>apply(value),locked),null,automationMenuItem(pluginParameterAutomation(controller,plugin,parameter))];
  };
  let parameterBusy=true,parameterMessage='Loading parameters from Freestyle…';
  // Drag: realtime set_plugin_param over mozart-control (Studio Pro). Release:
  // one queued typed REST write per parameter; other controls stay editable.
  // Undo: one history step per gesture. `before` is the last value Freestyle reported for this
  // parameter when the gesture started (a fresh read after a live drag would already see the new value).
  const gestureBefore=new Map(),confirmedParameterValue=index=>{const row=controller.parameters.find(item=>item.index===index);return row?controller.parameterControl(row)?.value:undefined;};
  const writeParameter=async(index,requested,{history=true}={})=>{
   const row=controller.parameters.find(item=>item.index===index),before=gestureBefore.has(index)?gestureBefore.get(index):confirmedParameterValue(index);gestureBefore.delete(index);
   if(parameterBusy){toast('Wait for the plugin parameters to finish loading, then try again.');clientLog('plugin-param-write',{index,requested,outcome:'busy'});return;}
   if(controller.parameterWriteValue(index)===requested)return;try{assertActive();}catch(error){parameterMessage=error.message;fail(error);if(d.isConnected)paintParameters();return;}
   const started=Date.now(),form=row?controller.parameterControl(row)?.form:null,historyScope=engine.patternHistory?.context?.();
   controller.liveParameter(plugin,index,requested,{flush:true});parameterMessage='';const pending=controller.queueParameter(plugin,index,requested);paintParameters();
   try{await pending;assertActive();remoteEditor?.refresh?.({fresh:true,editorFrameWoken:controller.takeEditorFrameWoken?.(plugin,index)===true});const after=confirmedParameterValue(index),unconfirmed=!!controller.pluginMutation?.requiresInspection;
    clientLog('plugin-param-write',{laneId:controller.target.id,pluginIndex:plugin.index,index,paramId:row?.id??null,form,before:before??null,requested,reported:after??null,unconfirmed,ms:Date.now()-started});
    if(unconfirmed){parameterMessage=`Freestyle accepted ${row?.name||'the parameter'} but reports ${after??'an unknown value'} instead of ${requested}. Inspect the plugin before editing again.`;toast(parameterMessage);}
    else{if(controller.parameterWriteValue(index)===undefined)toast('Plugin parameter updated in Freestyle.');if(history&&row&&Number.isFinite(before)&&Number.isFinite(after)&&Math.abs(before-after)>1e-9)recordPluginParameterHistory({c,plugin,index,paramId:row.id,name:row.name,form,before,after,scope:historyScope,dialog:{controller,isOpen:()=>d.isConnected&&d.open,repaint:()=>{if(d.isConnected)paintParameters();},refreshGui:()=>remoteEditor?.refresh?.({fresh:true})}});}}
   catch(error){parameterMessage=error.message;clientLog('plugin-param-write',{index,requested,outcome:'error',message:String(error.message||'').slice(0,200),code:error.code||null,status:error.status||null});fail(error);}finally{if(d.isConnected)paintParameters();}
  };
  const runParameter=async task=>{if(parameterBusy)return;parameterBusy=true;parameterMessage='';paintParameters();try{assertActive();await task();assertActive();}catch(error){parameterMessage=error.message;fail(error);}finally{parameterBusy=false;if(d.isConnected)paintParameters();}};
  const paintParameters=()=>{
   // Disabelton Device View: this window's confirmed values repaint the device's knobs (no extra read).
   if(controller.parameters.length&&controller.target?.kind==='lane')try{window.dispatchEvent(new CustomEvent('abl:plugin-values',{detail:{laneId:controller.target.id,instanceId:plugin.instance_id??plugin.instanceId??plugin.id,parameters:controller.parameters.map(row=>({index:row.index,normalized:row.normalized}))}}));}catch{}
   const page=controller.parameterPagination,params=controller.parameters.map(parameter=>({parameter,control:controller.parameterControl(parameter)})).filter(item=>item.control),host=content.querySelector('.plugin-parameter-page'),existing=new Map([...host.querySelectorAll('label[data-parameter-row]')].map(row=>[Number(row.dataset.parameterRow),row]));host.querySelector('.plugin-parameter-empty')?.remove();let nextRow=host.firstElementChild;
   for(const {parameter,control}of params){let row=existing.get(parameter.index);existing.delete(parameter.index);if(!row){row=document.createElement('label');row.dataset.parameterRow=String(parameter.index);row.innerHTML=`<span></span><input data-plugin-param="${parameter.index}" type="range" style="width:100%">`;}const label=row.querySelector('span'),input=row.querySelector('input');input.min=String(control.min);input.max=String(control.max);input.step=String(control.step);{const held=controller.parameterWriteValue(parameter.index)??controller.historyPreviewValues?.get(parameter.index);if(input.dataset.liveEditing!=='1')input.value=String(held!==undefined?held:control.value);}
    // The engine's display string can trail a write by one read; label from the value the control now holds.
    const paintLabel=()=>{label.textContent=parameter.name+(control.form==='physical'&&control.unit?` (${control.unit})`:'')+((value=>value?' · '+value:'')(parameterDisplay(parameter,control,input.valueAsNumber)));};paintLabel();input.setAttribute('aria-label',`${parameter.name} ${control.form==='physical'?control.unit||'physical value':'normalized value'}`);input.disabled=parameterBusy||!!page?.busy||parameter.stale===true;input.oninput=()=>{if(parameterBusy)return;if(!gestureBefore.has(parameter.index))gestureBefore.set(parameter.index,confirmedParameterValue(parameter.index));input.dataset.liveEditing='1';paintLabel();controller.liveParameter(plugin,parameter.index,input.valueAsNumber);};input.onchange=()=>{const requested=input.valueAsNumber;delete input.dataset.liveEditing;return writeParameter(parameter.index,requested);};if(row===nextRow)nextRow=nextRow.nextElementSibling;else host.insertBefore(row,nextRow);}for(const row of existing.values())row.remove();
   if(!params.length){const empty=document.createElement('p');empty.className='plugin-parameter-empty';empty.textContent=parameterBusy?'Loading parameters from Freestyle…':'No writable indexed parameters were returned for this page. Inspect parameter values to reload.';host.append(empty);}
   const loaded=page?.loaded??controller.parameters.length,total=page?.total;content.querySelector('.plugin-parameter-count').textContent=parameterBusy&&!loaded?'Loading parameters…':typeof total==='number'?`${loaded} of ${total} parameters loaded`:`${loaded} parameters loaded`;const more=content.querySelector('.plugin-parameter-more');more.hidden=!page?.hasMore;more.disabled=parameterBusy||!!page?.busy;more.textContent=page?.busy?'Loading parameters…':'Load more parameters';content.querySelector('.plugin-parameter-inspect').disabled=parameterBusy||!!page?.busy;content.querySelector('.plugin-parameter-status').textContent=parameterMessage||(page?.invalid?page.error||'Inspect parameter values to reload this plugin.':page?.stale>0?'Inspect parameter values to refresh other loaded controls.':'');
  };
  content.querySelector('.plugin-parameter-more').onclick=()=>runParameter(()=>controller.loadMoreParameters());content.querySelector('.plugin-parameter-inspect').onclick=()=>runParameter(async()=>{await controller.ensurePlugin(plugin);assertActive();await controller.readPlugin(plugin.index);});paintParameters();
  content.querySelector('.plugin-slots').onclick=()=>{assertActive();d.close();openSelectedMixerTools(c).catch(fail);};
  const editorBinding=()=>{if(editorController.target.kind!=='lane')throw new Error('Select a loaded lane plugin to open its original editor.');if(editorController.isRestMode){const binding=resolveRestPluginEditorBinding({savedProject:editorController.savedProject,projectId:editorController.projectId,laneId:editorController.target.id,plugin,plugins:editorController.plugins});if(!binding)throw new Error('Read this saved lane and its exact current plugin instance before opening its editor.');return resolvePluginEditorBinding({model:currentMixerModel(),projectId:editorController.projectId,laneId:editorController.target.id,plugin})||binding;}const runtime=editorController.runtimeTrack;if(!Number.isInteger(runtime?.id)||runtime.id<=0)throw new Error('Freestyle has not provided this plugin’s numeric engine track ID.');return{laneId:editorController.target.id,engineTrackId:runtime.id,pluginIndex:plugin.index,instanceId:plugin.instance_id??plugin.instanceId??plugin.id};};
  const readEditorBinding=async()=>{assertActive();await editorController.verifySlot(plugin);assertActive();return editorBinding();};
  const candidateEditorBinding=()=>{if(editorController.target.kind!=='lane')throw new Error('Select a loaded lane plugin to open its original editor.');const instanceId=plugin.instance_id??plugin.instanceId??plugin.id;if(typeof instanceId!=='string'||!instanceId.trim())throw new Error('Select this plugin’s exact instance before opening its editor.');if(editorController.isRestMode)return resolvePluginEditorBinding({model:currentMixerModel(),projectId:editorController.projectId,laneId:editorController.target.id,plugin})||{laneId:editorController.target.id,pluginIndex:plugin.index,instanceId};const runtime=editorController.runtimeTrack;if(!Number.isInteger(runtime?.id)||runtime.id<=0)throw new Error('Freestyle has not provided this plugin’s numeric engine track ID.');return{laneId:editorController.target.id,engineTrackId:runtime.id,pluginIndex:plugin.index,instanceId};};
  // GUI drag/scroll/type confirmed by effect: re-read the loaded typed parameter page (debounced, one read in flight).
  const guiParameterSync=createGuiParameterSync({canRead:()=>d.isConnected&&d.open&&!parameterBusy&&!controller.parameterPending&&controller.parameters.length>0&&!controller.pluginMutation?.requiresInspection,read:async()=>{assertActive();await controller.refreshParameters();assertActive();gestureHistory.noteRead();},repaint:()=>{if(d.isConnected)paintParameters();},log:clientLog});d.addEventListener('close',()=>guiParameterSync.close(),{once:true});
  // FL: each original-GUI gesture is one Undo step ("Change <Plugin> <Param>"): values captured at the gesture's start, read back once it is confirmed.
  const canReadParameters=()=>d.isConnected&&d.open&&!parameterBusy&&!controller.parameterPending&&controller.parameters.length>0&&!controller.pluginMutation?.requiresInspection;
  const gestureHistory=new PluginGestureRecorder({canCapture:canReadParameters,cached:()=>cachedGestureSnapshot(controller),read:async()=>{await pluginDialogIdle();assertActive();if(!canReadParameters())throw Object.assign(new Error('The plugin parameters are not readable right now.'),{code:'parameters_busy'});const rows=await readGestureSnapshot(controller,plugin);assertActive();if(d.isConnected)paintParameters();return rows;},record:changes=>recordPluginGestureHistory({c,plugin,changes,scope:engine.patternHistory?.context?.(),dialog:{controller,isOpen:()=>d.isConnected&&d.open,repaint:()=>{if(d.isConnected)paintParameters();},refreshGui:()=>remoteEditor?.refresh?.({fresh:true})}}),log:clientLog});d.addEventListener('close',()=>gestureHistory.close(),{once:true});
  const remoteButton=content.querySelector('.plugin-original-gui');remoteButton.onclick=async()=>{
   if(remoteButton.disabled)return;
   remoteButton.disabled=true;
   const viewport=document.createElement('div');viewport.className='native-plugin-viewport';viewport.textContent='Connecting to the cloud plugin editor…';
   content.querySelector('.native-plugin-viewport')?.remove();content.querySelector('.plugin-gui-panel').prepend(viewport);showPluginTab('gui');
   let lifecycle,viewer;
   const current=()=>d.isConnected&&d.open&&(!viewer||remoteEditor===viewer);
   const allowReopen=()=>{if(current()){remoteButton.disabled=false;remoteButton.textContent='Reopen original cloud plugin GUI';}};
   // Freestyle #3: a Main (master-bus) insert opens through the bus editor routes (same contract, bus_id 'master').
   if(editorController.isRestMode&&editorController.target.kind==='bus'&&editorController.target.id==='master'&&BUS_PLUGIN_GUI_OPERATIONS.every(name=>editorController.operations.has(name)))try{
    assertActive();await engine.flush();assertActive();await editorController.verifySlot(plugin);assertActive();const previous=remoteEditor,instanceId=plugin.instance_id??plugin.instanceId??plugin.id;
    viewer=new PluginGuiView({guard:assertGuiCurrent,whenIdle:pluginDialogIdle,inputBlocked:readOnlyRefusal,frameStream:null,target:{projectId:editorController.projectId,busId:'master',pluginIndex:plugin.index,instanceId:typeof instanceId==='string'?instanceId:null,pluginType:plugin.type_id??plugin.type??null,trackId:editorController.context().track_id},isVisible:()=>d.isConnected&&d.open&&d.dataset.pluginTab==='gui'&&!document.hidden,onGestureStart:detail=>gestureHistory.begin(detail),onGestureEnd:detail=>gestureHistory.end(detail),
     onTargetMissing:error=>{markPluginGuiUnavailable(c,plugin);if(current()&&d.dataset.pluginTab==='gui')showPluginTab('parameters');viewer?.setState?.('error',`${plugin.name||'This plugin'}: Freestyle could not reach its editor: ${error.message}`);},onStateChange:({state})=>{if(!current())return;if(state==='displaced'){viewport.classList.add('native-plugin-inactive');allowReopen();}else if(state==='error')allowReopen();}});
    remoteEditor=viewer;await previous?.close?.().catch(()=>{});assertActive();viewer.mount(viewport);await viewer.open();
    if(current())d.style.width='min(1000px,95vw)';else await viewer.close();return;
   }catch(error){if(current()){viewport.textContent=error.message;if(d.dataset.pluginTab==='gui'&&!viewport.querySelector('img[src]')){showPluginTab('parameters');toast('Main plug-in GUI unavailable: '+error.message+' Showing typed parameters.');}allowReopen();}return;}
   // Studio API v1 REST editor mirror (frame long-poll + forwarded input), see plugin-gui-view.js.
   if(editorController.isRestMode&&editorController.target.kind==='lane'&&pluginGuiSupported(editorController.operations))try{
    assertActive();await engine.flush();assertActive();const binding=candidateEditorBinding(),previous=remoteEditor,fresh=await readEditorBinding();if(fresh.laneId!==binding.laneId||fresh.pluginIndex!==binding.pluginIndex||fresh.instanceId!==binding.instanceId)throw new Error('The plugin instance changed before its original editor opened.');
    viewer=new PluginGuiView({guard:assertGuiCurrent,whenIdle:pluginDialogIdle,inputBlocked:readOnlyRefusal,frameStream:new EditorFrameStream({monitor:engine.monitor,log:clientLog}),target:{projectId:editorController.projectId,laneId:binding.laneId,pluginIndex:binding.pluginIndex,instanceId:binding.instanceId,pluginType:plugin.type_id??plugin.type??null,trackId:editorController.context().track_id},isVisible:()=>d.isConnected&&d.open&&d.dataset.pluginTab==='gui'&&!document.hidden,onParametersChanged:info=>{if(info?.kind==='type')guiParameterSync.schedule();},onGestureStart:detail=>gestureHistory.begin(detail),onGestureEnd:detail=>{gestureHistory.end(detail);},
     onMismatch:error=>{toast(`This plugin slot changed in Freestyle${error.currentPluginType?` (now ${error.currentPluginType})`:''}. Refreshing its plugin chain.`);controller.refreshPlugins().catch(()=>{});},onTargetMissing:error=>{markPluginGuiUnavailable(c,plugin);return verifyInstance(()=>{if(current()&&d.dataset.pluginTab==='gui')showPluginTab('parameters');viewer?.setState?.('error',`${plugin.name||'This plugin'} is still in the chain, but Freestyle could not reach its editor: ${error.message}`);});},onStateChange:({state})=>{if(!current())return;if(state==='displaced'){viewport.classList.add('native-plugin-inactive');allowReopen();}else if(state==='error'&&!viewer.ownershipBlocked)allowReopen();}});
    remoteEditor=viewer;await previous?.close?.().catch(()=>{});assertActive();viewer.mount(viewport);await viewer.open();
    if(current())d.style.width='min(1000px,95vw)';else await viewer.close();return;
   }catch(error){if(error?.status===409&&error.code==='target_not_loaded'){markPluginGuiUnavailable(c,plugin);viewport.textContent='Checking whether this plugin is still in its chain…';verifyInstance(()=>{viewport.textContent=error.message;allowReopen();if(current()&&d.dataset.pluginTab==='gui')showPluginTab('parameters');});return;}if(current()){viewport.querySelector('.plugin-gui-status')?viewport.querySelector('.plugin-gui-status').textContent=error.message:viewport.textContent=error.message;if(d.dataset.pluginTab==='gui'&&!viewport.querySelector('img[src]')){showPluginTab('parameters');toast('Original plugin GUI unavailable: '+error.message+' Showing typed parameters.');}if(error.code!=='editor_ownership_cleanup_failed')allowReopen();}return;}
   try{
    assertActive();await engine.flush();assertActive();
    if(engine.monitor.state!=='connected'){await connectLiveCloudAudio();assertActive();}
    if(!editorController.isRestMode){await editorController.refresh({readParameters:false});assertActive();}
    const binding=candidateEditorBinding();
    // A released lifecycle cannot open again. Each explicit reopen gets a new
    // lifecycle; the mirror coordinator first settles the prior captured hold.
    lifecycle=new CloudPluginEditorLifecycle({cloudCall:(name,args,options)=>engine.session.call(name,args,options),getContext:()=>({projectId:engine.projectId,trackId:engine.session.trackId,loadVersion:engine.loadVersion||0,contextVersion:engine.session.contextVersion||0,monitorGeneration:engine.monitor.generation||0}),guard:assertActive,onChange:state=>{if(state.action==='release'&&state.error)toast('Cloud plugin editor release was not confirmed: '+state.error);}});
    viewer=new RemotePluginEditor({monitor:engine.monitor,guard:()=>lifecycle.assertCurrent(lifecycle.scope),requestEditor:lifecycle.requestEditor,prepareTarget:async target=>{const prepared=await lifecycle.prepareTarget(target);assertActive();const fresh=await readEditorBinding();if(fresh.laneId!==binding.laneId||fresh.pluginIndex!==binding.pluginIndex||fresh.instanceId!==binding.instanceId)throw new Error('The plugin instance changed before its original editor opened.');return prepared;},editorArguments:action=>lifecycle.defaultArguments(action)});
    remoteEditor=viewer;
    // Native knob view: same one-step-per-gesture Undo. Its data-channel input has no acknowledgement, so the read-back waits one short settle.
    viewer.addEventListener('gesturestart',event=>gestureHistory.begin(event.detail));viewer.addEventListener('gestureend',event=>{const detail=event.detail;setTimeout(()=>gestureHistory.end(detail),250);});
    viewer.addEventListener('displaced',()=>{if(current()){viewport.classList.add('native-plugin-inactive');allowReopen();}});
    viewer.addEventListener('state',event=>{
     if(!current())return;
     if(event.detail.state==='error'&&lifecycle.snapshot().status!=='uncertain'&&viewer.ownershipState?.state!=='cleanup_unconfirmed')allowReopen();
     else if(['opening','waiting','decoding','ready'].includes(event.detail.state))remoteButton.disabled=true;
    });
    await viewer.open({projectId:controller.projectId,contextTrackId:controller.contextTrackId,...binding},viewport);
    if(!d.isConnected||!d.open){await viewer.close();return;}
    if(current())d.style.width='min(1000px,95vw)';
   }catch(error){
    if(current()){viewport.textContent=error.message;
     // No native GUI mirror: fall back to the typed parameter page (the GUI tab keeps the reason and Reopen).
     if(d.dataset.pluginTab==='gui'&&!viewport.querySelector('img[src]')){showPluginTab('parameters');toast('Original plugin GUI unavailable: '+error.message+' Showing typed parameters.');}
     remoteButton.disabled=lifecycle?.snapshot().status==='uncertain'||error.code==='editor_ownership_cleanup_failed';if(!remoteButton.disabled)remoteButton.textContent='Reopen original cloud plugin GUI';}
   }
  };
  for(const tab of content.querySelectorAll('[data-plugin-tab]'))tab.onclick=()=>{showPluginTab(tab.dataset.pluginTab);if(tab.dataset.pluginTab==='gui'&&!remoteEditor&&!remoteButton.disabled)remoteButton.onclick();};
  // Single-click channel opening shows the native GUI at once, like FL; typed parameters keep loading behind it.
  // QA r9: a built-in (native) effect has no engine editor target (its GUI open answered 409 target_not_loaded twice), and
  // a slot the engine already reported as not loaded is not asked again: both open on the built-in parameter editor.
  if(nativeFirst&&!eqTab){if(pluginGuiUnavailable(c,plugin))showPluginTab('parameters');else remoteButton.onclick();}
  // Freestyle #6: a device without an editor shows its parameter panel only (no GUI tab, no editor request).
  if(pluginIsBuiltIn(plugin)){const tab=content.querySelector('[data-plugin-tab="gui"]');if(tab)tab.hidden=true;remoteButton.disabled=true;remoteButton.title='This built-in device has no plug-in window; its parameters are shown.';if(d.dataset.pluginTab==='gui')showPluginTab('parameters');}
  // Disabelton Device View "+N" (Configure): the typed parameter list, the GUI still opens behind it.
  if(configure)showPluginTab('parameters');
 const openStarted=Date.now();let openPath='';
 try{await engine.flush();assertActive();if(!controller.isRestMode){await controller.refresh();assertActive();}if(controller.hasFreshInventory())openPath='cached-inventory';else if(controller.adoptSavedSlot(plugin))openPath='saved-slot';else openPath='live-inventory';if(openPath!=='saved-slot')await controller.ensurePlugin(plugin,{cached:true});assertActive();await controller.readPlugin(plugin.index);assertActive();gestureHistory.noteRead();parameterMessage='';clientLog('plugin-window-params',{channel:c?.name||null,laneId:controller.target.id,pluginIndex:plugin.index,path:openPath,ms:Date.now()-openStarted,loaded:controller.parameters.length,total:controller.parameterPagination.total});}
 catch(error){parameterMessage=error.message;clientLog('plugin-window-params-error',{channel:c?.name||null,laneId:controller.target?.id||null,pluginIndex:plugin.index,path:openPath,ms:Date.now()-openStarted,message:String(error.message||'').slice(0,200),code:error.code||null,status:error.status||null});if(d.isConnected&&d.open)fail(error);}
 finally{parameterBusy=false;if(d.isConnected&&d.open)paintParameters();}
 return d;
}
function pianoGesture({element,event,initial,compute,paint,restore=()=>{},commit=()=>{},isValid=()=>true,changed,viewport=null}={}){
 activePianoCancel?.();const scope=JSON.stringify(fileImportScope()),sessionProjectId=engine.session.projectId,valid=()=>scope===JSON.stringify(fileImportScope())&&sessionProjectId===engine.session.projectId&&isValid(),gesture=new PianoGesture({initial,origin:{clientX:event.clientX,clientY:event.clientY,pointerId:event.pointerId},compute,paint,restore,isValid:valid,...changed?{changed}:{}});let finished=false,physicalPoint={clientX:event.clientX,clientY:event.clientY,pointerId:event.pointerId};const initialScroll=viewport?{left:viewport.scrollLeft,top:viewport.scrollTop}:null,contentPoint=sample=>({clientX:sample.clientX+(viewport?viewport.scrollLeft-initialScroll.left:0),clientY:sample.clientY+(viewport?viewport.scrollTop-initialScroll.top:0),pointerId:event.pointerId});
 const autoscroll=viewport?new PlaylistAutoScroll({viewport,pointerId:event.pointerId,getInsets:()=>({left:PIANO_KEY_WIDTH,top:PIANO_RULER_HEIGHT}),isValid:valid,onScroll:()=>gesture.move(contentPoint(physicalPoint))}):null;autoscroll?.update(event,{enabled:false});
 const finish=(cancel,sample)=>{if(finished||!gesture.matches(sample))return;const finalPoint=Number.isFinite(sample?.clientX)&&Number.isFinite(sample?.clientY)?sample:physicalPoint;const result=gesture.finish(contentPoint(finalPoint),{cancel});if(!result)return;finished=true;autoscroll?.destroy();activePianoCancel=null;element.onpointermove=element.onpointerup=element.onpointercancel=element.onlostpointercapture=null;try{if(element.hasPointerCapture?.(event.pointerId))element.releasePointerCapture(event.pointerId);}catch{}engine.interacting=false;if(result.changed)commit(result.state);};
 const cancel=()=>finish(true);cancel.pointerId=event.pointerId;activePianoCancel=cancel;engine.interacting=true;try{element.setPointerCapture(event.pointerId);}catch{}element.onpointermove=sample=>{if(!gesture.matches(sample)||!Number.isFinite(sample?.clientX)||!Number.isFinite(sample?.clientY))return;physicalPoint={clientX:sample.clientX,clientY:sample.clientY,pointerId:event.pointerId};gesture.move(contentPoint(physicalPoint));autoscroll?.update(sample,{enabled:gesture.moved});};element.onpointerup=sample=>finish(false,sample);element.onpointercancel=element.onlostpointercapture=sample=>finish(true,sample);return gesture;
}
function pianoScope(current,p,c,notes,version){return project===current&&engine.loadVersion===version&&pattern()===p&&channel().id===c.id&&(p.notes[c.id]===notes||!p.notes[c.id]&&!notes.length);}
function pianoKeyAudition(event,key,c){
 if(event?.button!==0||event.isPrimary===false)return false;event.preventDefault();event.stopPropagation();activePianoCancel?.();
 if(engine.interacting||engine.loading||engine.applying||!engine.ready||workspaceBusy()||rangeBusy()||sliceBusy()||cloudLibrary?.writeBusy)return false;
 const raw=c.cloudSource||c.cloudRaw||{};
 // Samples retain their supported one-shot preview. Held ownership is only
 // available for instrument voices, never simulated by a global preview stop.
 if(c.type==='sample'||raw.kind==='sample'||raw.audioFileId||raw.audio_file_id){engine.preview(c,+key.dataset.pitch).catch(fail);key.classList.add('active');setTimeout(()=>key.classList.remove('active'),180);return true;}
 const current=project,p=pattern(),notes=p.notes[c.id]||[],version=engine.loadVersion,scope=pianoViewScope(),keys=$('#piano-keys'),viewport=$('#piano-scroll'),scale=pianoBarWidth,rowHeight=pianoRowHeight,scroll={left:viewport.scrollLeft,top:viewport.scrollTop};
 const getScope=()=>({...fileImportScope(),patternId:pattern()?.id,channelId:channel()?.id,binding:engine.getInstrumentAudition().binding(c),selection:engine.selectedPattern??null});
 try{getScope();}catch(error){toast(error.message);return false;}
 const valid=()=>pianoScope(current,p,c,notes,version)&&pianoViewScope()===scope&&pianoBarWidth===scale&&pianoRowHeight===rowHeight&&engine.ready&&!engine.loading&&!engine.applying&&viewport.scrollLeft===scroll.left&&viewport.scrollTop===scroll.top;
 let gesture=null,finished=false;const matches=sample=>sample?.pointerId==null||sample.pointerId===event.pointerId;
 const finish=(cancel,sample)=>{
  if(finished||!matches(sample))return false;finished=true;cancel?gesture?.cancel():gesture?.finish();viewport.removeEventListener('scroll',scrolled);
  for(const node of keys.querySelectorAll('.piano-key'))node.classList.remove('active','piano-key-pending');delete keys.dataset.auditionState;
  if(activePianoCancel===cancelGesture){activePianoCancel=null;engine.interacting=false;keys.onpointermove=keys.onpointerup=keys.onpointercancel=keys.onlostpointercapture=null;try{if(keys.hasPointerCapture?.(event.pointerId))keys.releasePointerCapture(event.pointerId);}catch{}}
  return true;
 };
 const cancelGesture=()=>finish(true);cancelGesture.pointerId=event.pointerId;
 const scrolled=()=>{if(!valid())finish(true);};
 const paint=state=>{
  if(finished)return;if(!state.active||!valid()){finish(true);return;}
  keys.dataset.auditionState=state.pending?'connecting':state.soundingPitch===null?'idle':'active';
  for(const node of keys.querySelectorAll('.piano-key')){const pitch=+node.dataset.pitch;node.classList.toggle('active',pitch===state.soundingPitch);node.classList.toggle('piano-key-pending',state.pending&&pitch===state.pitch);}
 };
 const sample=next=>{
  if(finished||!matches(next)||!Number.isFinite(next?.clientX)||!Number.isFinite(next?.clientY))return;if(!valid()){finish(true);return;}
  const rect=keys.getBoundingClientRect(),visible=viewport.getBoundingClientRect(),pitch=pianoPitchOfRow((next.clientY-rect.top)/rowHeight),inside=next.clientX>=rect.left&&next.clientX<rect.right&&next.clientY>=visible.top+PIANO_RULER_HEIGHT&&next.clientY<visible.bottom&&pitch>=0&&pitch<=127;
  gesture.move(inside?pitch:null);
 };
 try{
  gesture=new PianoKeyAuditionGesture({getScope,isCurrent:valid,acquireNote:(pitch,velocity)=>engine.acquireInstrumentNote(c,pitch,velocity),onChange:paint,onError:error=>{if(pianoViewScope()===scope)toast(error.message);}});
  activePianoCancel=cancelGesture;engine.interacting=true;viewport.addEventListener('scroll',scrolled);try{keys.setPointerCapture(event.pointerId);}catch{}
  keys.onpointermove=next=>{if(!matches(next))return;for(const item of next.getCoalescedEvents?.()||[])sample(item);sample(next);};keys.onpointerup=next=>finish(false,next);keys.onpointercancel=keys.onlostpointercapture=next=>finish(true,next);
  if(!gesture.start(+key.dataset.pitch)){finish(true);return false;}return true;
 }catch(error){finish(true);toast(error.message);return false;}
}
function togglePianoGhosts(){activePianoCancel?.();pianoGhostsEnabled=!pianoGhostsEnabled;renderPiano();}
function duplicatePianoNotes(){const notes=selectedPianoNotes();if(!notes.length)return;const offset=Math.max(...notes.map(n=>n.start+n.duration))-Math.min(...notes.map(n=>n.start));const p=pattern(),id=channel().id;edit(()=>{const pasted=PianoTools.duplicateNotes(notes,{offset:Math.max(.25,offset),ids:(p.notes[id]||[]).map(n=>n.id)});p.notes[id]=[...(p.notes[id]||[]),...pasted];clearPianoSelection();pasted.forEach(n=>selectedNotes.add(n.id));growPatternForNotes(p,pasted);});}
function clearPianoSelection(){selectedNotes.clear();selectedNote=null;}
function selectedPianoNotes(){const notes=pattern().notes[channel().id]||[];return selectedNotes.size?notes.filter(n=>selectedNotes.has(n.id)):notes;}
function transformPianoNotes(transform){const p=pattern(),id=channel().id,notes=p.notes[id]||[],ids=selectedNotes.size?new Set(selectedNotes):new Set(notes.map(n=>n.id));if(!ids.size)return toast('Draw notes in this channel first.');edit(()=>{const changes=new Map(transform(notes.filter(n=>ids.has(n.id))).map(n=>[n.id,n]));p.notes[id]=notes.map(n=>changes.get(n.id)||n);growPatternForNotes(p,p.notes[id]);});}
function copyPianoNotes(){pianoClipboard=PianoTools.copySelectedNotes(pattern().notes[channel().id]||[],selectedNotes.size?selectedNotes:undefined);toast(`${countLabel(pianoClipboard.notes?.length||pianoClipboard.length||0,'note')} copied.`);}
function cutPianoNotes(){const p=pattern(),id=channel().id,notes=p.notes[id]||[],selection=selectedNotes.size?new Set(selectedNotes):new Set(notes.map(n=>n.id));if(!selection.size)return;edit(()=>{pianoClipboard=PianoTools.copySelectedNotes(notes,selection);p.notes[id]=notes.filter(note=>!selection.has(note.id));clearPianoSelection();});}
function pastePianoNotes({at=visiblePianoPasteBeat($('#piano-scroll').scrollLeft,pianoBarWidth)}={}){if(!pianoClipboard)return toast('Copy some piano notes first.');const p=pattern(),id=channel().id;edit(()=>{const notes=p.notes[id]||[],pasted=PianoTools.pasteNotes(pianoClipboard,{at,ids:notes.map(n=>n.id)}),sourceId=p.cloudSources?.[id]??channel().sourceId;for(const note of pasted){if(note.channelId!=null)note.channelId=id;if(sourceId!=null){if(note.sourceId!=null)note.sourceId=sourceId;if(note.cloudRaw?.sourceId!=null)note.cloudRaw.sourceId=sourceId;}}p.notes[id]=[...notes,...pasted];clearPianoSelection();pasted.forEach(n=>selectedNotes.add(n.id));selectedNote=pasted[0]?.id||null;growPatternForNotes(p,pasted);});}
function quickQuantizePianoStarts(){
 if(activeEditor()!=='piano'||$('#piano').classList.contains('hidden'))return false;
 if(!coreFileEditable()||activePianoCancel||activePlaylistCancel||activeRackCancel||windows.dragging||windows.pending){toast('Finish the current edit before quick quantizing note starts.');return false;}
 const grid=pianoSnap();if(!Number.isFinite(grid)||grid<=0){toast('Choose a Piano snap grid before quick quantizing note starts.');return false;}
 const notes=selectedPianoNotes();if(!notes.length){toast('Draw notes in this channel first.');return false;}
 try{const quantized=PianoTools.quantizeNotes(notes,{grid,strength:1,quantizeEnds:false});if(!quantized.some((note,index)=>note.start!==notes[index].start))return false;const changes=new Map(quantized.map(note=>[note.id,note]));transformPianoNotes(current=>current.map(note=>changes.get(note.id)||note));return true;}catch(error){fail(error);return false;}
}
function quantizePianoDialog(){const d=dialog('Piano roll — Quantizer',`<p>Quantize ${selectedNotes.size?'selected notes':'this channel'} in the Freestyle pattern.</p><label>Grid</label><select id="quantize-grid"><option value=".125">1/32 note</option><option value=".25" selected>1/16 note</option><option value=".5">1/8 note</option><option value="1">1/4 note</option></select><label>Strength <span id="quantize-strength-label">100%</span></label><input id="quantize-strength" type="range" min="0" max="1" step=".05" value="1" style="width:100%"><label><input id="quantize-ends" type="checkbox"> Quantize note ends</label><button id="quantize-apply" class="primary">Apply to cloud pattern</button>`);d.querySelector('#quantize-strength').oninput=e=>d.querySelector('#quantize-strength-label').textContent=`${Math.round(+e.target.value*100)}%`;d.querySelector('#quantize-apply').onclick=()=>{const options={grid:+d.querySelector('#quantize-grid').value,strength:+d.querySelector('#quantize-strength').value,quantizeEnds:d.querySelector('#quantize-ends').checked};transformPianoNotes(notes=>PianoTools.quantizeNotes(notes,options));d.close();};}
function pianoMinimumNote(p){const raw=p.cloudRaw?.data?.pattern?p.cloudRaw.data:p.cloudRaw,ppq=Number(raw?.ppq);return 1/(Number.isFinite(ppq)&&ppq>0?ppq:96);}
function notePropertiesScope(){return{projectId:engine.projectId,trackId:engine.session.trackId,loadVersion:engine.loadVersion||0,contextVersion:engine.session.contextVersion||0,patternId:pattern()?.id,channelId:channel()?.id,selection:[...selectedNotes].sort(),tool:pianoTool};}
function paintNoteProperties(preview){
 if(!preview){if(notePropertiesFrame!==null)cancelAnimationFrame(notePropertiesFrame);notePropertiesFrame=null;notePropertiesPreview=null;for(const [node,original]of notePropertiesStyles){node.style.cssText=original.css;if(original.text!==undefined)node.firstChild.textContent=original.text;}notePropertiesStyles.clear();return;}
 for(const node of notePropertiesStyles.keys())if(!node.isConnected)notePropertiesStyles.delete(node);
 notePropertiesPreview=preview;if(notePropertiesFrame!==null)return;
 notePropertiesFrame=requestAnimationFrame(()=>{notePropertiesFrame=null;const pending=notePropertiesPreview;if(!pending||JSON.stringify(pending.scope)!==JSON.stringify(notePropertiesScope()))return paintNoteProperties(null);
  const updates=new Map(pending.notes.map(note=>[note.id,note]));
  for(const node of $$('.piano-note[data-note]')){if(!pending.noteIds.includes(node.dataset.note))continue;const note=updates.get(node.dataset.note);if(!note)continue;if(!notePropertiesStyles.has(node))notePropertiesStyles.set(node,{css:node.style.cssText,text:node.firstChild.textContent});node.style.left=`${note.start/4*pianoBarWidth}px`;node.style.width=`${note.duration/4*pianoBarWidth}px`;node.style.top=`${pianoNoteTop(note.pitch,pianoRowHeight)}px`;node.firstChild.textContent=flNoteName(note.pitch);}
  for(const node of $$('#piano [data-velocity]')){if(!pending.noteIds.includes(node.dataset.velocity))continue;const note=updates.get(node.dataset.velocity);if(!note)continue;if(!notePropertiesStyles.has(node))notePropertiesStyles.set(node,{css:node.style.cssText});node.style.height=`${(note.velocity??.8)*PIANO_VELOCITY_RANGE}px`;}
 });
}
function openNoteProperties(noteId){
 if(!playlistEditable())return null;activePianoCancel?.();activePlaylistCancel?.();
 if(!selectedNotes.has(noteId)){clearPianoSelection();selectedNotes.add(noteId);selectedNote=noteId;renderPiano();}
 return noteProperties.open({noteId,selectedIds:[...selectedNotes],ppq:1/pianoMinimumNote(pattern())});
}
noteProperties=new PianoNoteProperties({dialog,getCurrentScope:notePropertiesScope,getNotes:()=>pattern()?.notes?.[channel()?.id]||[],onPreview:paintNoteProperties,onStatus:toast,commit:async({scope,before,notes,noteIds})=>{
 if(JSON.stringify(scope)!==JSON.stringify(notePropertiesScope())||JSON.stringify(before)!==JSON.stringify(pattern().notes[channel().id]||[]))throw new Error('The note properties context changed before the edit.');
 if(engine.loading||rangeBusy()||sliceBusy()||cloudLibrary?.writeBusy||engine.interacting)throw new Error('Finish the current cloud operation before accepting note properties.');
 const p=pattern(),c=channel(),applied=edit(()=>{p.notes[c.id]=notes;growPatternForNotes(p,notes);});if(!applied)return false;
 const expectedEvents=serializeCloudPattern(p,project).pattern.events,nativeIds=new Map(noteIds.map(id=>[id,String(notes.find(note=>note.id===id)?.cloudRaw?.id??id)]));
 await engine.flush();if(JSON.stringify(scope)!==JSON.stringify(notePropertiesScope()))throw new Error('The cloud project changed while note properties were saved.');
 const accepted=engine.session.project,actualPattern=accepted?.patterns?.find(item=>item.id===scope.patternId),actual=actualPattern?.notes?.[scope.channelId],actualEvents=actualPattern?serializeCloudPattern(actualPattern,accepted).pattern.events:[];
 // Confirm the exact native tick DTO; beat multiplication/division can differ
 // by a floating-point bit even when Freestyle preserved every authored tick.
 if(!Array.isArray(actual)||noteIds.some(id=>{const nativeId=nativeIds.get(id),expected=expectedEvents.find(event=>String(event.id)===nativeId),observed=actualEvents.find(event=>String(event.id)===nativeId);return!expected||!observed||['id','sourceId','type','note','startTick','durationTick','velocity'].some(key=>expected[key]!==observed[key]);}))throw new Error('Freestyle has not confirmed the requested note properties.');
 return true;
}});
function restructurePianoNotes(operation){
 activePianoCancel?.();const p=pattern(),id=channel().id,notes=p.notes[id]||[],selection=selectedNotes.size?new Set(selectedNotes):null,options={selectedIds:selection,minDuration:pianoMinimumNote(p)};let next;
 try{next=operation==='slice'?PianoTools.sliceNotes(notes,pianoCursor,options):operation==='chop'?PianoTools.chopNotes(notes,{...options,grid:pianoSnap()}):PianoTools.glueNotes(notes,options);}catch(error){fail(error);return false;}
 if(next===notes)return false;
 return edit(()=>{p.notes[id]=next;clearPianoSelection();if(selection)for(const note of next)if(selection.has(note.id)||!notes.includes(note))selectedNotes.add(note.id);selectedNote=selectedNotes.values().next().value||null;growPatternForNotes(p,next);});
}
function pianoMenu(e){activePianoCancel?.();menu(e,[['Draw notes','P',()=>setPianoTool('draw')],['Paint notes','B',()=>setPianoTool('paint')],['Delete notes','D',()=>setPianoTool('erase')],['Select notes','E',()=>setPianoTool('select')],['Zoom','Z',()=>setPianoTool('zoom')],['Play selected / scrub','Y',()=>setPianoTool('playback')],['Mute notes','T',()=>setPianoTool('mute')],['Slide notes','S',()=>setPianoTool('slide')],null,['Select all notes','⌘A',()=>{clearPianoSelection();(pattern().notes[channel().id]||[]).forEach(n=>selectedNotes.add(n.id));renderPiano();}],['Clear selection','',()=>{clearPianoSelection();renderPiano();}],null,['Cut notes','⌘X',cutPianoNotes],['Copy notes','⌘C',copyPianoNotes],['Paste notes at visible bar','⌘V',()=>pastePianoNotes()],['Paste notes at cursor','',()=>pastePianoNotes({at:pianoCursor})],['Duplicate selection','⌘B',duplicatePianoNotes],['Clear this channel’s notes','',()=>$('#piano-clear').click()],['Ghost channels',pianoGhostsEnabled?'✓ Alt/Opt+V':'Alt/Opt+V',togglePianoGhosts],['Preview notes',pianoPreviewNotes?'✓':'',togglePianoPreviewNotes],null,['Slice notes at cursor','',()=>restructurePianoNotes('slice')],['Quick chop','',()=>restructurePianoNotes('chop')],['Glue touching notes','⌘G',()=>restructurePianoNotes('glue')],null,['Quick quantize start times','Shift+Q',quickQuantizePianoStarts],['Quantize…','Alt+Q',quantizePianoDialog],['Transpose up an octave','',()=>transformPianoNotes(notes=>PianoTools.transposeNotes(notes,12))],['Transpose down an octave','',()=>transformPianoNotes(notes=>PianoTools.transposeNotes(notes,-12))],['Legato','',()=>transformPianoNotes(notes=>PianoTools.legatoNotes(notes,patternLengthBeats(pattern())))],['Scale velocity…','',()=>textDialog('Piano roll velocity','Velocity multiplier (0–2)','1',v=>{if(+v>=0&&+v<=2)transformPianoNotes(notes=>PianoTools.scaleNoteVelocities(notes,+v));})]]);}
/** FL Mute (T) / Slide (S) tool click on a note: toggles the Freestyle `muted` / `slide`
 * note flag on it (or on the whole selection it belongs to) as ONE undoable score edit. */
function togglePianoNoteFlag(note,flag){
 engine.interacting=false;const p=pattern(),c=channel(),notes=p.notes[c.id]||[];if(!notes.some(item=>item.id===note.id))return false;
 const next=PianoTools.toggleNoteFlag(notes,flag,note.id,selectedNotes.has(note.id)?selectedNotes:null),changed=next.filter((item,index)=>item[flag]!==notes[index][flag]).length,on=note[flag]!==true;
 if(!changed)return false;const applied=edit(()=>{p.notes[c.id]=next;});
 if(applied)toast(`${flag==='muted'?(on?'Muted':'Unmuted'):(on?'Slide on':'Slide off')}: ${countLabel(changed,'note')}${flag==='slide'&&on?' (Freestyle stores slide; playback glides are not rendered yet)':''}.`);return applied;
}
function setPianoTool(value){if(!['draw','paint','erase','select','slice','zoom','playback','mute','slide','glue','velocity'].includes(value))return;if(value==='mute'&&pianoTool!=='mute')toast('Mute tool (T): click a note to mute or unmute it (a selected note toggles the selection).');if(value==='slide'&&pianoTool!=='slide')toast('Slide tool (S): click a note to toggle its slide flag.');activeRackCancel?.();activePianoCancel?.();pianoTool=value;noteProperties?.syncScope();$('#piano').dataset.pianoTool=value;for(const [id,kind]of [['piano-draw','draw'],['piano-paint','paint'],['piano-erase','erase'],['piano-select','select'],['piano-slice','slice'],['piano-zoom','zoom'],['piano-playback','playback'],['piano-mute','mute'],['piano-slide','slide']])$('#'+id)?.classList.toggle('selected',value===kind);syncPianoToolMenus();}
function pianoView(){const viewport=$('#piano-scroll');return{scale:pianoBarWidth,rowHeight:pianoRowHeight,scrollLeft:viewport.scrollLeft,scrollTop:viewport.scrollTop};}
function pianoViewScope(){return JSON.stringify([engine.projectId,engine.session.trackId,engine.loadVersion,engine.session.contextVersion,pattern()?.id,channel()?.id]);}
function applyPianoView(view){
 pianoRowHeight=Math.max(6,Math.min(70,view.rowHeight));renderPiano();pianoViewport.setView(view);$('#velocity-grid').scrollLeft=$('#piano-scroll').scrollLeft;pianoNavigator?.refresh();
}
/** FL zoom drag, shared by the Piano roll and the Playlist: the Zoom tool's left/right button,
 * or Ctrl/Cmd+right-drag in any tool (a temporary zoom-to-region). */
function zoomDragRequest(event,zoomToolActive){return [0,2].includes(event.button)&&!event.altKey&&!event.shiftKey&&(zoomToolActive&&!event.ctrlKey&&!event.metaKey||event.button===2&&(event.ctrlKey||event.metaKey));}
function pianoZoomRequest(event){return zoomDragRequest(event,pianoTool==='zoom');}
/** The Playlist Zoom tool keeps every button/modifier it had; Ctrl/Cmd+right-drag zooms from any tool. */
/** Logic Tracks area: the Zoom tool, or a Control-Option drag with any tool (the right button opens the region menu). */
function playlistZoomRequest(event){return tool==='zoom'||event.button===0&&!!event.ctrlKey&&!!event.altKey&&!event.metaKey&&!event.shiftKey;}
function pianoZoom(event){
 if(event.isPrimary===false||!pianoZoomRequest(event))return false;event.preventDefault();event.stopPropagation();activePianoCancel?.();activePlaylistCancel?.();activeRackCancel?.();
 if(engine.interacting||engine.loading||engine.applying||workspaceBusy()||rangeBusy()||sliceBusy()||cloudLibrary?.writeBusy)return false;
 const viewport=$('#piano-scroll'),grid=$('#piano-grid'),width=viewport.clientWidth-PIANO_KEY_WIDTH,height=viewport.clientHeight-PIANO_RULER_HEIGHT;if(width<=0||height<=0)return false;
 const before=pianoView(),scope=pianoViewScope(),originalTool=pianoTool,contentBeats=Math.max(16,Math.ceil(patternLengthBeats(pattern())/4)+4)*4;
 if(event.button===2&&!event.ctrlKey&&!event.metaKey){const high=Math.min(127,Math.max(72,...(pattern().notes[channel().id]||[]).map(note=>note.pitch))+5),next=pianoZoomPrevious?.scope===scope?pianoZoomPrevious.view:{scale:PIANO_DEFAULT_BAR_WIDTH,rowHeight:PIANO_ROW_HEIGHT,scrollLeft:0,scrollTop:(127-high)*PIANO_ROW_HEIGHT};pianoZoomPrevious={scope,view:before};applyPianoView(next);return true;}
 const bounds=grid.getBoundingClientRect(),origin={beat:Math.max(0,(event.clientX-bounds.left)/before.scale*4),row:Math.max(0,Math.min(128,(event.clientY-bounds.top)/before.rowHeight))},marker=document.createElement('div');marker.className='piano-zoom-rect';marker.setAttribute('aria-hidden','true');grid.append(marker);
 const valid=()=>pianoViewScope()===scope&&pianoTool===originalTool&&pianoBarWidth===before.scale&&pianoRowHeight===before.rowHeight&&!engine.loading&&!engine.applying;
 pianoGesture({element:grid,event,viewport,initial:origin,compute:({deltaX,deltaY})=>({beat:origin.beat+deltaX/before.scale*4,row:origin.row+deltaY/before.rowHeight}),isValid:valid,changed:()=>true,paint:point=>{marker.style.cssText=`left:${Math.min(origin.beat,point.beat)*before.scale/4}px;top:${Math.min(origin.row,point.row)*before.rowHeight}px;width:${Math.abs(point.beat-origin.beat)*before.scale/4}px;height:${Math.abs(point.row-origin.row)*before.rowHeight}px`;},restore:()=>marker.remove(),commit:point=>{
  const distance=Math.hypot((point.beat-origin.beat)*before.scale/4,(point.row-origin.row)*before.rowHeight);let next;
  if(distance<4){const scale=Math.max(40,before.scale*.8),rowHeight=Math.max(6,before.rowHeight*.8);next={scale,rowHeight,scrollLeft:Math.max(0,before.scrollLeft+origin.beat*(scale-before.scale)/4),scrollTop:Math.max(0,before.scrollTop+origin.row*(rowHeight-before.rowHeight))};}
  else next=fitPianoZoomRectangle({before,origin,end:point,gridWidth:width,gridHeight:height,contentBeats});
  if(!next)return;pianoZoomPrevious={scope,view:before};applyPianoView(next);
 }});return true;
}
function pianoScrubRequest(event){return pianoTool==='playback'&&[0,2].includes(event.button)&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey;}
function pianoScrub(event){
 if(event.isPrimary===false||!pianoScrubRequest(event))return false;event.preventDefault();event.stopPropagation();activePianoCancel?.();activePlaylistCancel?.();activeRackCancel?.();
 if(engine.interacting||engine.loading||engine.applying||!engine.ready||workspaceBusy()||rangeBusy()||sliceBusy()||cloudLibrary?.writeBusy)return false;
 const current=project,p=pattern(),c=channel(),notes=p.notes[c.id]||[],version=engine.loadVersion,scope=pianoViewScope(),grid=$('#piano-grid'),viewport=$('#piano-scroll'),scale=pianoBarWidth,rowHeight=pianoRowHeight,rect=grid.getBoundingClientRect(),initialLeft=viewport.scrollLeft,noteId=event.target.closest?.('.piano-note[data-note]')?.dataset.note??null;
 const getScope=()=>({...fileImportScope(),patternId:pattern()?.id,channelId:channel()?.id,binding:engine.getInstrumentAudition().binding(c),selection:engine.selectedPattern??null});
 try{getScope();}catch(error){const raw=c.cloudRaw||c.cloudSource||{},sample=raw.audioFileId||raw.audio_file_id;toast(sample?'This sample supports one-shot preview; held-note scrub needs sample voice controls. Use a piano key to preview it.':error.message);return false;}
 const marker=document.createElement('div');marker.className='piano-scrub-cursor';marker.setAttribute('aria-hidden','true');grid.append(marker);
 const nodes=new Map($$('.piano-note[data-note]').map(node=>[node.dataset.note,node])),valid=()=>pianoScope(current,p,c,notes,version)&&pianoViewScope()===scope&&pianoTool==='playback'&&pianoBarWidth===scale&&pianoRowHeight===rowHeight&&engine.ready&&!engine.loading&&!engine.applying;
 const matches=sample=>sample?.pointerId==null||sample.pointerId===event.pointerId,toBeat=sample=>Math.max(0,(sample.clientX-rect.left+viewport.scrollLeft-initialLeft)/scale*4);let finished=false,moved=false,scrub=null,auto=null,physical=event,lastBeat=toBeat(event);
 const finish=(cancel,sample)=>{
  if(finished||!matches(sample))return false;finished=true;
  if(!cancel&&valid()&&Number.isFinite(sample?.clientX)){const beat=toBeat(sample);if(beat!==lastBeat){moved=true;scrub?.move(beat);}}
  if(cancel)scrub?.cancel();else scrub?.finish();auto?.destroy();marker.remove();for(const node of nodes.values())node.classList.remove('piano-scrub-active');delete $('#piano').dataset.auditionState;
  if(activePianoCancel===cancelGesture){activePianoCancel=null;engine.interacting=false;grid.onpointermove=grid.onpointerup=grid.onpointercancel=grid.onlostpointercapture=null;try{if(grid.hasPointerCapture?.(event.pointerId))grid.releasePointerCapture(event.pointerId);}catch{}}
  if(pianoScrubCancel===cancelGesture)pianoScrubCancel=null;return true;
 };
 const cancelGesture=()=>finish(true);cancelGesture.pointerId=event.pointerId;
 const paint=state=>{
  if(finished)return;if(state.finished||!valid()){finish(true);return;}
  const confirmed=new Set(state.soundingPitches),pending=state.pitches.some(pitch=>!confirmed.has(pitch));marker.style.left=`${state.beat/4*scale}px`;marker.classList.toggle('pending',pending);$('#piano').dataset.auditionState=pending?'connecting':confirmed.size?'active':'idle';
  for(const note of notes){const active=confirmed.has(note.pitch)&&(!moved&&noteId!==null?note.id===noteId:note.start<=state.beat&&state.beat<note.start+note.duration);nodes.get(note.id)?.classList.toggle('piano-scrub-active',active);}
 };
 const sample=next=>{
  if(finished||!matches(next)||!Number.isFinite(next?.clientX)||!Number.isFinite(next?.clientY))return;if(!valid()){finish(true);return;}
  physical=next;const beat=toBeat(next);if(beat!==lastBeat){moved=true;lastBeat=beat;scrub.move(beat);}auto?.update(next,{enabled:moved});
 };
 try{
  scrub=new PianoScrubGesture({notes,getScope,isCurrent:valid,acquireNote:(pitch,velocity)=>engine.acquireInstrumentNote(c,pitch,velocity),onChange:paint,onError:error=>{if(pianoViewScope()===scope)toast(error.message);}});
  auto=new PlaylistAutoScroll({viewport,pointerId:event.pointerId,getInsets:()=>({left:PIANO_KEY_WIDTH,top:PIANO_RULER_HEIGHT}),isValid:valid,onScroll:()=>sample(physical)});auto.update(event,{enabled:false});
  activePianoCancel=pianoScrubCancel=cancelGesture;engine.interacting=true;try{grid.setPointerCapture(event.pointerId);}catch{}
  grid.onpointermove=next=>{if(!matches(next))return;const samples=next.getCoalescedEvents?.()||[];for(const item of samples)sample(item);sample(next);};grid.onpointerup=next=>finish(false,next);grid.onpointercancel=grid.onlostpointercapture=next=>finish(true,next);
  if(!scrub.start(noteId,{beat:lastBeat})){finish(true);return false;}return true;
 }catch(error){finish(true);toast(error.message);return false;}
}
function pianoSlice(event){
 if(event.button!==0)return;event.preventDefault();event.stopPropagation();activePianoCancel?.();if(!playlistEditable())return;
 const current=project,p=pattern(),c=channel(),notes=p.notes[c.id]||[],version=engine.loadVersion,contextVersion=engine.session.contextVersion,grid=$('#piano-grid'),rect=grid.getBoundingClientRect(),scale=pianoBarWidth,from={beat:(event.clientX-rect.left)/scale*4,row:(event.clientY-rect.top)/pianoRowHeight},snap=event.altKey?0:pianoSnap(),minimum=pianoMinimumNote(p),children=new Map(),reserved=new Set(Object.values(p.notes||{}).flat().flatMap(note=>[String(note.id),String(note.cloudRaw?.id??'')])),nodes=new Map($$('.piano-note[data-note]').map(node=>[node.dataset.note,node])),visibility=new Map([...nodes].map(([id,node])=>[id,node.style.visibility]));
 const layer=document.createElement('div');layer.className='piano-slice-layer';layer.setAttribute('aria-hidden','true');layer.style.cssText='position:absolute;inset:0;pointer-events:none;z-index:6';grid.append(layer);
 const idForNote=id=>{if(!children.has(id)){let next;do{next=crypto.randomUUID();}while(reserved.has(next));reserved.add(next);children.set(id,next);}return children.get(id);},blur=()=>activePianoCancel?.();let errorMessage='';
 const compute=({deltaX,deltaY})=>{const to={beat:from.beat+deltaX/scale*4,row:from.row+deltaY/pianoRowHeight};try{return slicePianoLine(notes,{from,to,snapBeats:snap,minDuration:minimum,idForNote});}catch(error){if(errorMessage!==error.message){errorMessage=error.message;toast(error.message);}return{notes,cuts:[],from,to};}};
 pianoGesture({element:grid,event,viewport:$('#piano-scroll'),initial:{notes,cuts:[],from,to:from},compute,changed:(_before,after)=>after.cuts.length>0,isValid:()=>pianoScope(current,p,c,notes,version)&&engine.session.contextVersion===contextVersion&&pianoTool==='slice'&&engine.ready&&!engine.loading&&!engine.applying&&!workspaceBusy()&&!rangeBusy()&&!sliceBusy()&&!cloudLibrary?.writeBusy,paint:state=>{const ids=new Set(state.cuts.map(cut=>cut.noteId)),fragmentIds=new Set(state.cuts.flatMap(cut=>[cut.noteId,cut.childId]));for(const [id,node]of nodes)node.style.visibility=ids.has(id)?'hidden':visibility.get(id);const x=state.from.beat/4*scale,y=state.from.row*pianoRowHeight,dx=(state.to.beat-state.from.beat)/4*scale,dy=(state.to.row-state.from.row)*pianoRowHeight;layer.innerHTML=`<div class="piano-slice-line" style="position:absolute;left:${x}px;top:${y}px;width:${Math.hypot(dx,dy)}px;border-top:1px solid #e8f6ba;transform-origin:0 0;transform:rotate(${Math.atan2(dy,dx)}rad)"></div>`+state.notes.filter(note=>fragmentIds.has(note.id)).map(note=>`<div class="piano-note piano-slice-preview" style="left:${note.start/4*scale}px;top:${pianoNoteTop(note.pitch,pianoRowHeight)}px;width:${note.duration/4*scale}px">${flNoteName(note.pitch)}</div>`).join('');},restore:()=>{layer.remove();for(const [id,node]of nodes)node.style.visibility=visibility.get(id);window.removeEventListener('blur',blur);},commit:state=>edit(()=>{p.notes[c.id]=state.notes;clearPianoSelection();for(const cut of state.cuts){selectedNotes.add(cut.noteId);selectedNotes.add(cut.childId);}selectedNote=selectedNotes.values().next().value||null;pianoCursor=state.cuts[0]?.beat??pianoCursor;})});window.addEventListener('blur',blur,{once:true});
}
/** FL "preview notes": a drawn, clicked or pitch-dragged note sounds its
 * channel through the existing owned live-voice lease (never a score write).
 * One voice per gesture, retriggered on pitch change, released at pointer-up
 * after a short minimum so quick clicks remain audible, and capped. */
const PIANO_PREVIEW_MIN_MS=90,PIANO_PREVIEW_MAX_MS=4000;
function pianoNotePreview(c,velocity=.8){
 const idle={play(){},stop(){}};if(!pianoPreviewNotes||!c)return idle;
 const raw=c.cloudSource||c.cloudRaw||{},sample=c.type==='sample'||raw.kind==='sample'||!!raw.audioFileId||!!raw.audio_file_id,level=Number.isFinite(velocity)?Math.max(0,Math.min(1,velocity)):.8;
 let lease=null,pitch=null,since=0,cap=null,done=false,reported=false;
 const report=error=>{if(reported||error?.name==='AbortError')return;reported=true;toast(error.message||String(error));};
 const drop=options=>{clearTimeout(cap);cap=null;const held=lease;lease=null;try{held?.release(options);}catch(error){report(error);}};
 return{
  play(next){if(done||!Number.isInteger(next)||next<0||next>127||next===pitch)return;pitch=next;
   /* Owner bug 6: a sample at its root pitch previews over the control channel (sample_preview, ~0 ms to send) like the pads; REST only as the fallback. */
   if(sample){let realtime=false;if(next===60)try{realtime=engine.sampleAudition?.play?.(c,{velocity:level})!==false;}catch{realtime=false;}if(!realtime)engine.preview(c,next).catch(report);return;}
   drop();try{lease=engine.acquireInstrumentNote(c,next,level);since=performance.now();Promise.resolve(lease.ready).catch(report);cap=setTimeout(drop,PIANO_PREVIEW_MAX_MS);}catch(error){lease=null;report(error);}},
  /* {tail:true}: a preview that ends before the engine connection opened (project just loaded) still sounds once it opens. */
  stop(){if(done)return;done=true;if(!lease)return;const wait=PIANO_PREVIEW_MIN_MS-(performance.now()-since);if(wait<=0)drop({tail:true});else{clearTimeout(cap);cap=setTimeout(()=>drop({tail:true}),wait);}},
 };
}
function togglePianoPreviewNotes(){pianoPreviewNotes=!pianoPreviewNotes;toast(`Preview notes ${pianoPreviewNotes?'on':'off'}`);}
function paintMidiKeys(pitches=midiInput?.pitches()||new Set()){for(const key of $$('#piano-keys .piano-key'))key.classList.toggle('midi-active',pitches.has(+key.dataset.pitch));}
function pianoDraw(event,{pitch,start}){
 if(event.isPrimary===false||event.button!==0)return false;event.preventDefault();event.stopPropagation();activePianoCancel?.();if(!playlistEditable())return false;
 const current=project,p=pattern(),c=channel(),notes=p.notes[c.id]||[],version=engine.loadVersion,grid=$('#piano-grid'),scale=pianoBarWidth,rowHeight=pianoRowHeight,rect=grid.getBoundingClientRect(),originBeat=(event.clientX-rect.left)/scale*4,snapMode=pianoSnapMode,globalSnap=$('#snap').value,bypass=event.altKey,duration=+$('#note-length').value,drawTool=pianoTool;// Pencil as left tool, or ⌘-click Pencil over any left tool
 if(!Number.isInteger(pitch)||pitch<0||pitch>127||!Number.isFinite(start)||start<0||!Number.isFinite(duration)||duration<=0)return false;
 const sourceIdentity=()=>JSON.stringify([c.id,c.patternId,c.sourceId,c.laneId,c.instrumentType,c.type,c.cloudSource||null,c.cloudRaw||null]),sourceBinding=sourceIdentity();
 const initial={id:uid(),pitch,start,duration,velocity:.8},preview=document.createElement('div');preview.className='piano-note piano-draw-preview';preview.dataset.note=initial.id;preview.setAttribute('aria-hidden','true');grid.append(preview);
 const audition=pianoNotePreview(c,initial.velocity),paint=note=>{preview.style.left=`${note.start/4*scale}px`;preview.style.top=`${pianoNoteTop(note.pitch,rowHeight)}px`;preview.style.width=`${note.duration/4*scale}px`;preview.textContent=flNoteName(note.pitch);audition.play(note.pitch);};paint(initial);
 const valid=()=>pianoScope(current,p,c,notes,version)&&sourceIdentity()===sourceBinding&&pianoTool===drawTool&&pianoBarWidth===scale&&pianoRowHeight===rowHeight&&pianoSnapMode===snapMode&&$('#snap').value===globalSnap&&engine.ready&&!engine.loading&&!engine.editBlocked&&!sliceBusy()&&!cloudLibrary?.writeBusy;
 pianoGesture({element:grid,event,viewport:$('#piano-scroll'),initial,changed:()=>true,isValid:valid,compute:({deltaX,deltaY},note)=>({...note,start:quantizePiano(originBeat+deltaX/scale*4,{bypass}),pitch:pianoPitchShift(note.pitch,Math.round(deltaY/rowHeight))}),paint,restore:()=>{preview.remove();audition.stop();},commit:note=>{if(!valid())return;edit(()=>{p.notes[c.id]||=[];p.notes[c.id].push(note);growPatternForNotes(p,[note]);clearPianoSelection();selectedNotes.add(note.id);selectedNote=note.id;pianoCursor=note.start;});}});return true;
}
function rememberPianoLength(note){const value=String(note.duration),select=$('#note-length');if(!Number.isFinite(note.duration)||note.duration<=0)return;if(![...select.options].some(option=>option.value===value)){const option=document.createElement('option');option.value=value;option.textContent=`${Number(note.duration.toFixed(6))} beats`;option.dataset.authored='true';select.append(option);}select.value=value;}
function pianoStroke(event,{erase=false}={}){
 if(![0,2].includes(event.button))return;event.preventDefault();event.stopPropagation();activePianoCancel?.();if(!playlistEditable()){engine.interacting=false;return;}
 const current=project,p=pattern(),c=channel(),notes=p.notes[c.id]||[],version=engine.loadVersion,grid=$('#piano-grid'),viewport=$('#piano-scroll'),rect=grid.getBoundingClientRect(),scroll={left:viewport.scrollLeft,top:viewport.scrollTop},scale=pianoBarWidth,originalTool=pianoTool;
 const layer=document.createElement('div');layer.className='piano-stroke-layer';layer.setAttribute('aria-hidden','true');grid.append(layer);const nodes=new Map($$('[data-note],[data-velocity]').map(node=>[`${node.hasAttribute('data-note')?'note':'velocity'}:${node.dataset.note??node.dataset.velocity}`,node])),visibility=new Map([...nodes].map(([id,node])=>[id,node.style.visibility]));
 let finished=false,physical={clientX:event.clientX,clientY:event.clientY,pointerId:event.pointerId};const matches=sample=>sample?.pointerId==null||sample.pointerId===event.pointerId,toPoint=sample=>({beat:(sample.clientX-rect.left+viewport.scrollLeft-scroll.left)/scale*4,row:pianoUnfoldedRow((sample.clientY-rect.top+viewport.scrollTop-scroll.top)/pianoRowHeight)});
 const valid=()=>pianoScope(current,p,c,notes,version)&&pianoTool===originalTool&&engine.ready&&!engine.loading&&!engine.editBlocked&&!sliceBusy()&&!cloudLibrary?.writeBusy;
 const restore=()=>{layer.remove();for(const [id,node]of nodes)node.style.visibility=visibility.get(id);};
 let strokeAuditioned=0;const auditionStroke=state=>{const created=state?.created||[];if(!erase&&created.length>strokeAuditioned){const note=created[created.length-1];strokeAuditioned=created.length;try{const audition=pianoNotePreview(c,Number.isFinite(note.velocity)?note.velocity:.8);audition.play(note.pitch);audition.stop();}catch{}}else if(created.length<strokeAuditioned)strokeAuditioned=created.length;};
 let stroke;try{stroke=new PianoStroke({notes,mode:erase?'erase':'paint',length:+$('#note-length').value,snapBeats:event.altKey?0:pianoSnap(),source:{...c.sourceId?{sourceId:c.sourceId}:{},channelId:c.id},isValid:valid,restore,onInvalid:()=>finish(true),paint:state=>{/* Owner bug 6 / Live Preview: a note sounds the moment it is drawn (on the press, not on release); dragging on auditions each new note once. */auditionStroke(state);layer.innerHTML=state.created.map(note=>`<div class="piano-note piano-stroke-preview" style="left:calc(${note.start/4} * var(--bar));top:${pianoNoteTop(note.pitch,pianoRowHeight)}px;width:calc(${note.duration/4} * var(--bar))"></div>`).join('');for(const id of state.erased){const note=nodes.get(`note:${id}`),bar=nodes.get(`velocity:${id}`);if(note)note.style.visibility='hidden';if(bar)bar.style.visibility='hidden';}}});}catch(error){restore();engine.interacting=false;fail(error);return;}
 const autoscroll=new PlaylistAutoScroll({viewport,pointerId:event.pointerId,getInsets:()=>({left:PIANO_KEY_WIDTH,top:PIANO_RULER_HEIGHT}),isValid:valid,onScroll:()=>{try{stroke.addPoint(toPoint(physical));}catch(error){finish(true);fail(error);}}});
 const finish=(cancel,sample)=>{if(finished||!matches(sample))return;finished=true;autoscroll.destroy();activePianoCancel=null;grid.onpointermove=grid.onpointerup=grid.onpointercancel=grid.onlostpointercapture=null;try{if(grid.hasPointerCapture?.(event.pointerId))grid.releasePointerCapture(event.pointerId);}catch{}let result;try{result=stroke.finish(Number.isFinite(sample?.clientX)&&Number.isFinite(sample?.clientY)?toPoint(sample):toPoint(physical),{cancel});}catch(error){stroke.finish(undefined,{cancel:true});engine.interacting=false;fail(error);return;}engine.interacting=false;if(!result.changed)return;p.notes[c.id]=result.notes;clearPianoSelection();for(const note of result.created)selectedNotes.add(note.id);selectedNote=selectedNotes.values().next().value||null;growPatternForNotes(p,result.notes);changed();};
 activePianoCancel=Object.assign(()=>finish(true),{pointerId:event.pointerId});engine.interacting=true;try{grid.setPointerCapture(event.pointerId);}catch{}
 grid.onpointermove=sample=>{if(!matches(sample)||!Number.isFinite(sample?.clientX)||!Number.isFinite(sample?.clientY))return;physical={clientX:sample.clientX,clientY:sample.clientY,pointerId:event.pointerId};try{stroke.addPoint(toPoint(physical));autoscroll.update(physical);}catch(error){finish(true);fail(error);}};grid.onpointerup=sample=>finish(false,sample);grid.onpointercancel=grid.onlostpointercapture=sample=>finish(true,sample);
 try{stroke.addPoint(toPoint(physical));/* the press itself sounds the note (a quick click ends before the first paint frame) */try{auditionStroke(stroke.snapshot());}catch{}autoscroll.update(physical,{enabled:false});}catch(error){finish(true);fail(error);}
}
function renderPiano(){applyPianoGeometry($('#piano'),{rowHeight:pianoRowHeight});noteProperties?.syncScope();
 activePianoCancel?.();
 const c=channel(),p=pattern(),notes=projectStepPiano(p,c),target=p.id+':'+c.id,changedTarget=pianoTarget!==target;
 if(changedTarget){pianoZoomPrevious=null;clearPianoSelection();pianoCursor=0;pianoNeedsFocus=true;midiInput?.releaseAll();}
 const noteIds=new Set(notes.map(n=>n.id));for(const id of selectedNotes)if(!noteIds.has(id))selectedNotes.delete(id);
 // Logic's local inspector header: the region name, then its track (channel) and the note selection.
 $('#piano-title').textContent=p.name||'Region';$('#piano-title').title=`Region: ${p.name||'Region'}`;$('#piano-region-status').textContent=`${c.name}${selectedNotes.size?` · ${countLabel(selectedNotes.size,'note')} selected`:''}`;
 renderPianoRuler(Math.max(16,Math.ceil(patternLengthBeats(p)/4)+4));
 const top=127,grid=$('#piano-grid');grid.dataset.top=top;
 /* Fold: notes that moved onto a hidden key track bring that track into view; the rows listed are the shown key tracks. */
 if(pianoFold()){const shown=new Set(pianoFold());let grew=false;for(const n of notes)if(Number.isInteger(n.pitch)&&n.pitch>=0&&n.pitch<=127&&!shown.has(n.pitch)){shown.add(n.pitch);grew=true;}if(grew)setPianoFold([...shown]);}
 const rowPitches=pianoFold()||Array.from({length:PIANO_PITCH_COUNT},(_,i)=>top-i);$('#piano').classList.toggle('piano-folded',!!pianoFold());
 setMarkupIfChanged($('#piano-keys'),rowPitches.map(pitch=>{return `<div class="piano-key ${[1,3,6,8,10].includes(pitch%12)?'black':''}" data-pitch="${pitch}" title="${flNoteName(pitch)} · MIDI ${pitch}"><span>${pitch%12===0?flNoteName(pitch):''}</span></div>`;}).join(''));
 grid.innerHTML=rowPitches.map((pitch,i)=>[1,3,6,8,10].includes(pitch%12)?`<div class="piano-grid-row" style="top:${i*pianoRowHeight}px"></div>`:'').join('')+pianoGhostMarkup(p,c.id,{enabled:pianoGhostsEnabled,rowHeight:pianoRowHeight})+notes.filter(n=>Number.isInteger(n.pitch)&&n.pitch>=0&&n.pitch<=127).map(n=>`<div class="piano-note ${selectedNotes.has(n.id)?'selected':''}${n.muted===true?' muted':''}${n.slide===true?' slide':''}${n.duration<.5?' short':''}" data-note="${esc(n.id)}"${n.muted===true||n.slide===true?` title="${[n.muted===true?'Muted note':'',n.slide===true?'Slide note':''].filter(Boolean).join(' · ')}"`:''} style="left:calc(${n.start/4} * var(--bar));top:${pianoNoteTop(n.pitch,pianoRowHeight)}px;width:calc(${n.duration/4} * var(--bar));--note-color:${logicVelocityColor(n.velocity)}" data-midi-velocity="${midiVelocity(n.velocity)}">${flNoteName(n.pitch)}${n.slide===true?'<span class="note-slide" aria-hidden="true"></span>':''}<div class="note-resize"></div></div>`).join('');
 $$('#piano [data-piano-beat]').forEach(el=>el.onclick=()=>{pianoCursor=+el.dataset.pianoBeat;toast(`Piano cursor: bar ${pianoCursor/4+1}`);});
 $$('#piano .piano-key').forEach(key=>key.onpointerdown=event=>pianoKeyAudition(event,key,c));paintMidiKeys();
 grid.onpointerdown=e=>{
  if(e.target!==grid||![0,2].includes(e.button))return;
  if(pianoZoomRequest(e))return pianoZoom(e);
  if(pianoScrubRequest(e))return pianoScrub(e);
  // Logic: right-click (and Ctrl-click) opens the Piano Roll context menu; it never erases.
  if(e.button===2)return;
  // ⌘ uses the ⌘-click tool (Pencil by default), as in Logic.
  const active=logicEffectiveTool(e,{tool:pianoTool,commandTool:pianoCommandTool});
  if(active==='slice'&&!e.ctrlKey&&!e.shiftKey)return pianoTool==='slice'?pianoSlice(e):undefined;
  if(active==='erase'&&!e.ctrlKey&&!e.shiftKey)return pianoStroke(e,{erase:true});
  const rect=grid.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top,pitch=pianoPitchOfRow(y/pianoRowHeight),start=quantizePiano(x/pianoBarWidth*4,{bypass:e.altKey});pianoCursor=start;
  // Pointer (and the note-only Velocity/Glue tools) on empty space: drag = marquee, click = deselect.
  if(e.ctrlKey||e.shiftKey||['select','velocity','glue'].includes(active)){
   const initial=e.shiftKey?new Set(selectedNotes):new Set(),box=document.createElement('div'),current=project,version=engine.loadVersion;box.className='piano-selection-box';grid.append(box);
   const rectAtStart=grid.getBoundingClientRect(),origin={x:e.clientX-rectAtStart.left,y:e.clientY-rectAtStart.top},draw=point=>{box.style.cssText=`left:${Math.min(origin.x,point.x)}px;top:${Math.min(origin.y,point.y)}px;width:${Math.abs(point.x-origin.x)}px;height:${Math.abs(point.y-origin.y)}px`;};
   pianoGesture({element:grid,event:e,viewport:$('#piano-scroll'),initial:origin,compute:({deltaX,deltaY})=>({x:origin.x+deltaX,y:origin.y+deltaY}),paint:draw,restore:()=>box.remove(),isValid:()=>pianoScope(current,p,c,notes,version),changed:()=>true,commit:point=>{clearPianoSelection();initial.forEach(id=>selectedNotes.add(id));const left=Math.min(origin.x,point.x),right=Math.max(origin.x,point.x),upper=Math.min(origin.y,point.y),lower=Math.max(origin.y,point.y);if(left!==right&&upper!==lower)for(const n of notes){const nx=n.start/4*pianoBarWidth,ny=pianoRowOfPitch(n.pitch)*pianoRowHeight;if(nx+n.duration/4*pianoBarWidth>left&&nx<right&&ny+pianoRowHeight>upper&&ny<lower)selectedNotes.add(n.id);}selectedNote=selectedNotes.values().next().value||null;renderPiano();}});return;
  }
  if(active==='paint')return pianoStroke(e);
  // Mute / Slide tools act on notes only; an empty-grid click just moves the cursor.
  if(active==='mute'||active==='slide'){engine.interacting=false;return;}
  if(active!=='draw'){engine.interacting=false;return;}
  return pianoDraw(e,{pitch,start});
 };
 grid.oncontextmenu=e=>pianoContextMenu(e,null);
 // Gestures own grid.onpointermove; the header readout listens separately.
 if(!grid.dataset.positionReadout){grid.dataset.positionReadout='1';grid.addEventListener('pointermove',e=>{const bounds=grid.getBoundingClientRect(),pitch=pianoPitchOfRow((e.clientY-bounds.top)/pianoRowHeight),beat=Math.max(0,(e.clientX-bounds.left)/pianoBarWidth*4),readout=$('#piano-position');if(readout&&Number.isFinite(beat))readout.textContent=logicPositionReadout(pitch>=0&&pitch<=127?pitch:null,beat);});}
 $$('#piano .piano-note').forEach(el=>{el.onpointerdown=e=>noteDrag(e,el);el.ondblclick=e=>{e.preventDefault();e.stopPropagation();if(['zoom','playback'].includes(pianoTool))return;try{openNoteProperties(el.dataset.note);}catch(error){fail(error);}};el.oncontextmenu=e=>pianoContextMenu(e,el.dataset.note);});
 syncPianoInspector();
 $('#velocity-grid').innerHTML=notes.map(n=>`<div class="velocity-bar ${selectedNotes.has(n.id)?'selected':''}${n.muted===true?' muted':''}" data-velocity="${esc(n.id)}" style="left:calc(${n.start/4} * var(--bar));height:${n.velocity*PIANO_VELOCITY_RANGE}px" title="Velocity ${Math.round(n.velocity*100)}%"></div>`).join('');
 $$('#piano [data-velocity]').forEach(el=>{el.onpointerdown=e=>velocityDrag(e,el);});
 const totalBars=Math.max(16,Math.ceil(patternLengthBeats(p)/4)+4);$('#piano .piano-grid-wrap').style.width=`calc(${PIANO_KEY_WIDTH}px + ${totalBars} * var(--bar))`;$('#piano .piano-grid-wrap').style.height=`${pianoRowCount()*pianoRowHeight+PIANO_RULER_HEIGHT}px`;grid.style.height=`${pianoRowCount()*pianoRowHeight}px`;
 pianoTarget=target;if(pianoNeedsFocus&&!$('#piano').classList.contains('hidden')){const high=notes.length?Math.max(...notes.map(n=>n.pitch)):72;/* the Clip View fits an opened clip itself */if(!window.ablClipView?.ownsScroll?.(target))$('#piano-scroll').scrollTop=Math.max(0,(127-Math.min(127,high+5))*pianoRowHeight);pianoNeedsFocus=false;}$('#piano-scroll').onscroll=()=>{$('#velocity-grid').scrollLeft=$('#piano-scroll').scrollLeft;};if(notePropertiesPreview)paintNoteProperties(notePropertiesPreview);pianoNavigator?.refresh();
}
function pianoCloneDrag(event,element,p,c,notes,note){
 event.preventDefault();if(!playlistEditable()){engine.interacting=false;return;}
 const current=project,version=engine.loadVersion,selected=selectedNotes.has(note.id),group=selected?notes.filter(note=>selectedNotes.has(note.id)):[note],scale=pianoBarWidth,rowHeight=pianoRowHeight,tool=pianoTool,snapMode=pianoSnapMode,globalSnap=$('#snap').value,snap=pianoSnap();// Option is Logic's copy modifier here, not a snap bypass.
 const sourceIdentity=()=>JSON.stringify([c.id,c.patternId,c.sourceId,c.laneId,c.instrumentType,c.type,c.cloudSource||null,c.cloudRaw||null]),sourceBinding=sourceIdentity(),scoreIdentity=JSON.stringify(notes),raw=p.cloudRaw?.data?.pattern?p.cloudRaw.data:p.cloudRaw;
 // Duplicate allocation preserves authored duration/opaque metadata and replaces both IDs.
 const clones=PianoTools.duplicateNotes(group,{offset:0,existingNotes:Object.values(p.notes||{}).flat(),ids:(raw?.pattern?.events||[]).map(event=>event.id)});
 const layer=document.createElement('div');layer.className='piano-stroke-layer piano-clone-layer';layer.setAttribute('aria-hidden','true');$('#piano-grid').append(layer);
 const originalNodes=$$('#piano-grid .piano-note[data-note]'),selection=new Map(originalNodes.map(node=>[node,node.classList.contains('selected')])),previews=new Map();
 for(const node of originalNodes)node.classList.remove('selected');
 for(const clone of clones){const node=document.createElement('div');node.className='piano-note piano-clone-preview'+(selected?' selected':'');node.dataset.note=clone.id;node.style.pointerEvents='none';layer.append(node);previews.set(clone.id,node);}
 const paint=state=>{for(const note of state){const node=previews.get(note.id);node.style.left=`${note.start/4*scale}px`;node.style.top=`${pianoNoteTop(note.pitch,rowHeight)}px`;node.style.width=`${note.duration/4*scale}px`;node.textContent=flNoteName(note.pitch);}};paint(clones);
 const valid=()=>pianoScope(current,p,c,notes,version)&&sourceIdentity()===sourceBinding&&JSON.stringify(notes)===scoreIdentity&&pianoTool===tool&&pianoBarWidth===scale&&pianoRowHeight===rowHeight&&pianoSnapMode===snapMode&&$('#snap').value===globalSnap&&engine.ready&&!engine.loading&&!engine.editBlocked&&!sliceBusy()&&!cloudLibrary?.writeBusy;
 pianoGesture({element,event,viewport:$('#piano-scroll'),initial:clones,changed:()=>true,isValid:valid,compute:({deltaX,deltaY},initial)=>movePianoGesture(initial,{deltaBeats:deltaX/scale*4,deltaPitch:pianoPitchShift(note.pitch,Math.round(deltaY/rowHeight))-note.pitch,snapBeats:snap}),paint,restore:()=>{layer.remove();for(const [node,wasSelected]of selection)node.classList.toggle('selected',wasSelected);},commit:state=>{if(!valid())return;edit(()=>{p.notes[c.id]=[...notes,...state];growPatternForNotes(p,state);clearPianoSelection();if(selected){for(const clone of state)selectedNotes.add(clone.id);selectedNote=state[0]?.id||null;}pianoCursor=state[group.indexOf(note)]?.start??note.start;});}});
}
function noteDrag(e,el){
 if(e.isPrimary===false)return;
 if(pianoZoomRequest(e))return pianoZoom(e);
  if(pianoScrubRequest(e))return pianoScrub(e);
 // Logic: right-click opens the context menu (contextmenu event); it never erases a note.
 if(e.button!==0)return;
 const active=logicEffectiveTool(e,{tool:pianoTool,commandTool:pianoCommandTool}),plain=!e.ctrlKey&&!e.shiftKey&&!e.altKey,edge=e.target.classList.contains('note-resize');
 if(active==='slice'&&plain)return pianoTool==='slice'?pianoSlice(e):undefined;
 e.stopPropagation();activePianoCancel?.();const p=pattern(),c=channel(),notes=p.notes[c.id]||[],n=notes.find(n=>n.id===el.dataset.note);if(!n)return;
 if(active==='erase'&&!e.ctrlKey&&!e.shiftKey)return pianoStroke(e,{erase:true});
 if(active==='paint'&&plain&&!edge){rememberPianoLength(n);return pianoStroke(e);}
 if((active==='mute'||active==='slide')&&plain){e.preventDefault();return togglePianoNoteFlag(n,active==='mute'?'muted':'slide');}
 if(active==='velocity'&&plain)return pianoVelocityTool(e,el,n);
 if(active==='glue'&&plain){e.preventDefault();engine.interacting=false;if(!selectedNotes.has(n.id)||selectedNotes.size<2)return toast('Glue Tool: select the touching notes, then click one of them.');return restructurePianoNotes('glue');}
 rememberPianoLength(n);
 // Logic: Shift-click toggles a note in the selection (Ctrl kept for non-Mac keyboards).
 // Ctrl+Shift-drag moves without snapping (Logic's fine adjustment).
 const fine=e.ctrlKey&&e.shiftKey;
 if(!fine&&(e.ctrlKey||e.shiftKey&&!edge)){selectedNotes.has(n.id)?selectedNotes.delete(n.id):selectedNotes.add(n.id);selectedNote=selectedNotes.values().next().value||null;engine.interacting=false;renderPiano();return;}
 // Logic: Option-drag copies.
 if(e.altKey&&!edge)return pianoCloneDrag(e,el,p,c,notes,n);
 if(!playlistEditable()){engine.interacting=false;return;}
 if(!selectedNotes.has(n.id)){clearPianoSelection();selectedNotes.add(n.id);}selectedNote=n.id;pianoCursor=n.start;
 const current=project,version=engine.loadVersion,group=notes.filter(n=>selectedNotes.has(n.id)),initialById=new Map(group.map(note=>[note.id,note])),resizing=e.target.classList.contains('note-resize'),elements=new Map($$('#piano .piano-note').map(node=>[node.dataset.note,node])),styles=new Map([...elements].map(([id,node])=>[id,node.style.cssText]));
 for(const [id,node]of elements)node.classList.toggle('selected',selectedNotes.has(id));
 const audition=resizing?pianoNotePreview(null):pianoNotePreview(c,n.velocity);audition.play(n.pitch);
 pianoGesture({element:el,event:e,viewport:$('#piano-scroll'),initial:group,compute:({deltaX,deltaY},initial)=>movePianoGesture(initial,{deltaBeats:deltaX/pianoBarWidth*4,deltaPitch:pianoPitchShift(n.pitch,Math.round(deltaY/pianoRowHeight))-n.pitch,snapBeats:e.altKey||fine?0:pianoSnap(),resize:resizing,minDuration:pianoMinimumNote(p)}),paint:state=>{for(const update of state){const node=elements.get(update.id);if(!node)continue;if(resizing)node.style.width=`${update.duration/4*pianoBarWidth}px`;else node.style.transform=`translate3d(${(update.start-initialById.get(update.id).start)/4*pianoBarWidth}px,${(pianoRowOfPitch(update.pitch)-pianoRowOfPitch(initialById.get(update.id).pitch))*pianoRowHeight}px,0)`;}const lead=state.find(update=>update.id===n.id);if(lead)audition.play(lead.pitch);},restore:()=>{for(const [id,node]of elements)node.style.cssText=styles.get(id);audition.stop();},isValid:()=>pianoScope(current,p,c,notes,version),commit:state=>{const updates=new Map(state.map(n=>[n.id,n]));p.notes[c.id]=notes.map(note=>updates.get(note.id)||note);growPatternForNotes(p,state);changed();
  // FL: a resized note's length becomes the length of the next drawn note.
  if(resizing){const lead=updates.get(n.id);if(lead)rememberPianoLength(lead);}}});
}
function velocityDrag(e,el){
 if(e.button!==0)return;e.stopPropagation();activePianoCancel?.();if(!playlistEditable()){engine.interacting=false;return;}const current=project,version=engine.loadVersion,p=pattern(),c=channel(),notes=p.notes[c.id]||[],note=notes.find(n=>n.id===el.dataset.velocity);if(!note){engine.interacting=false;return;}const group=selectedNotes.has(note.id)?notes.filter(n=>selectedNotes.has(n.id)):[note],bars=new Map($$('#piano [data-velocity]').map(node=>[node.dataset.velocity,node])),heights=new Map([...bars].map(([id,node])=>[id,node.style.height]));
 pianoGesture({element:el,event:e,initial:group,compute:({deltaY},initial)=>velocityPianoGesture(initial,-deltaY/pianoVelocityLanePx()),paint:state=>{for(const update of state){const bar=bars.get(update.id);if(bar)bar.style.height=`${update.velocity*PIANO_VELOCITY_RANGE}px`;}},restore:()=>{for(const [id,node]of bars)node.style.height=heights.get(id);},isValid:()=>pianoScope(current,p,c,notes,version),commit:state=>{const updates=new Map(state.map(n=>[n.id,n]));p.notes[c.id]=notes.map(n=>updates.get(n.id)||n);changed();}});
}
// ---- Logic Piano Roll: Velocity tool, context menu, local inspector, tool and local menus ----
// Every score change below goes through the existing edit()/transformPianoNotes() history path.
const pianoQuantize={grid:'1/16',strength:100,swing:50,scaleRoot:'Off',scale:'Major (Ionian)'};
function pianoVelocityTool(e,el,note){
 e.preventDefault();if(!playlistEditable()){engine.interacting=false;return;}
 const current=project,version=engine.loadVersion,p=pattern(),c=channel(),notes=p.notes[c.id]||[],tool=pianoTool,group=selectedNotes.has(note.id)?notes.filter(n=>selectedNotes.has(n.id)):[note];
 const nodes=new Map($$('#piano .piano-note[data-note]').map(node=>[node.dataset.note,node])),bars=new Map($$('#piano [data-velocity]').map(node=>[node.dataset.velocity,node])),noteStyles=new Map([...nodes].map(([id,node])=>[id,[node.style.cssText,node.dataset.midiVelocity]])),barStyles=new Map([...bars].map(([id,node])=>[id,node.style.cssText])),readout=$('#piano-position'),before=readout?.textContent??'';
 // Logic Velocity tool: drag up/down; about one MIDI velocity step per pixel.
 pianoGesture({element:el,event:e,initial:group,compute:({deltaY},initial)=>velocityPianoGesture(initial,-deltaY/127),paint:state=>{for(const update of state){const node=nodes.get(update.id);if(node){node.style.setProperty('--note-color',logicVelocityColor(update.velocity));node.dataset.midiVelocity=String(midiVelocity(update.velocity));}const bar=bars.get(update.id);if(bar)bar.style.height=`${update.velocity*PIANO_VELOCITY_RANGE}px`;}const lead=state.find(update=>update.id===note.id);if(lead&&readout)readout.textContent=`Velocity ${midiVelocity(lead.velocity)}`;},restore:()=>{for(const [id,node]of nodes){const [css,velocity]=noteStyles.get(id);node.style.cssText=css;if(velocity!==undefined)node.dataset.midiVelocity=velocity;}for(const [id,node]of bars)node.style.cssText=barStyles.get(id);if(readout)readout.textContent=before;},isValid:()=>pianoScope(current,p,c,notes,version)&&pianoTool===tool,commit:state=>{const updates=new Map(state.map(n=>[n.id,n]));p.notes[c.id]=notes.map(n=>updates.get(n.id)||n);changed();}});
}
function selectAllPianoNotes(){activePianoCancel?.();clearPianoSelection();(pattern().notes[channel().id]||[]).forEach(n=>selectedNotes.add(n.id));selectedNote=selectedNotes.values().next().value||null;renderPiano();}
function deletePianoSelection(){if(!selectedNotes.size)return false;const p=pattern(),id=channel().id,ids=new Set(selectedNotes);return edit(()=>{p.notes[id]=(p.notes[id]||[]).filter(n=>!ids.has(n.id));clearPianoSelection();});}
/** Q: Logic Time Quantize (grid, Strength, Swing) on the selection (or the whole region with none). */
function quantizePianoSelection(){
 if(activePianoCancel)return toast('Finish the current edit before quantizing.'),false;
 const grid=timeQuantizeBeats(pianoQuantize.grid);if(!grid){toast('Choose a Time Quantize value first.');return false;}
 const notes=selectedPianoNotes();if(!notes.length){toast('Draw notes in this region first.');return false;}
 const next=quantizeLogic(notes,{grid,strength:pianoQuantize.strength,swing:pianoQuantize.swing});if(next.every((note,index)=>note.start===notes[index].start)){toast('The notes are already quantized.');return false;}
 const changes=new Map(next.map(note=>[note.id,note]));transformPianoNotes(current=>current.map(note=>changes.get(note.id)||note));return true;
}
function scaleQuantizePianoSelection(){
 if(pianoQuantize.scaleRoot==='Off'){toast('Choose a Scale Quantize root note first.');return false;}
 const notes=selectedPianoNotes();if(!notes.length)return false;const next=scaleQuantizeNotes(notes,{root:pianoQuantize.scaleRoot,scale:pianoQuantize.scale});
 if(next.every((note,index)=>note.pitch===notes[index].pitch)){toast('The notes are already in the scale.');return false;}
 const changes=new Map(next.map(note=>[note.id,note]));transformPianoNotes(current=>current.map(note=>changes.get(note.id)||note));return true;
}
function toggleSelectedNotesMuted(){const p=pattern(),c=channel(),notes=p.notes[c.id]||[],ids=new Set(selectedNotes);if(!ids.size)return false;const value=!notes.filter(n=>ids.has(n.id)).every(n=>n.muted===true);return edit(()=>{p.notes[c.id]=PianoTools.setNoteFlag(notes,'muted',value,{selectedIds:ids});});}
function setSelectedNoteVelocity(midi){const ids=new Set(selectedNotes);if(!ids.size)return false;const velocity=Math.max(1,Math.min(127,Math.round(midi)))/127,p=pattern(),c=channel(),notes=p.notes[c.id]||[];if(notes.filter(n=>ids.has(n.id)).every(n=>midiVelocity(n.velocity)===Math.round(velocity*127)))return false;return edit(()=>{p.notes[c.id]=notes.map(n=>ids.has(n.id)?{...n,velocity}:n);});}
function pianoContextMenu(e,noteId){
 e.preventDefault();e.stopPropagation?.();
 // A right-button zoom/scrub drag keeps its gesture; a Mac Ctrl-click replaces the marquee it just began.
 if(activePianoCancel){if(e.button===2)return;activePianoCancel();}
 if(noteId&&!selectedNotes.has(noteId)){clearPianoSelection();selectedNotes.add(noteId);selectedNote=noteId;renderPiano();}
 const items=logicPianoContextMenu({onNote:!!noteId,selection:selectedNotes.size,clipboard:!!pianoClipboard,editable:playlistEditable(),quantize:LOGIC_TIME_QUANTIZE.find(item=>item.id===pianoQuantize.grid)?.label||'Off'});
 const run={cut:cutPianoNotes,copy:copyPianoNotes,paste:()=>pastePianoNotes({at:pianoCursor}),delete:deletePianoSelection,'select-all':selectAllPianoNotes,deselect:()=>{clearPianoSelection();renderPiano();},quantize:quantizePianoSelection,'scale-quantize':scaleQuantizePianoSelection,'transpose-up':()=>transformPianoNotes(notes=>PianoTools.transposeNotes(notes,12)),'transpose-down':()=>transformPianoNotes(notes=>PianoTools.transposeNotes(notes,-12)),mute:toggleSelectedNotesMuted,legato:()=>transformPianoNotes(notes=>PianoTools.legatoNotes(notes,patternLengthBeats(pattern()))),glue:()=>restructurePianoNotes('glue'),properties:()=>openNoteProperties(selectedNote||[...selectedNotes][0])};
 menu(e,items.map(item=>item&&{label:item.label,shortcut:item.shortcut||'',disabled:!!item.disabled,title:item.disabled?item.reason||'':'',run:run[item.id]}));
 $('#context-menu').dataset.menu='piano-context';
}
function syncPianoToolMenus(){
 for(const [id,current,kind]of [['piano-tool-left',pianoTool,'Left-click Tool'],['piano-tool-command',pianoCommandTool,'⌘-click Tool']]){const button=$('#'+id),tool=logicPianoTool(current);if(!button)continue;button.textContent=tool?.glyph||'↖';button.title=`${kind}: ${tool?.label||current}`;button.setAttribute('aria-label',button.title);button.dataset.tool=current;}
}
function pianoToolMenu(event,command=false){
 activePianoCancel?.();const button=event.currentTarget||event.target,bounds=button.getBoundingClientRect(),current=command?pianoCommandTool:pianoTool;
 menu({clientX:bounds.left,clientY:bounds.bottom},LOGIC_PIANO_TOOLS.filter(tool=>!command||!['zoom','playback'].includes(tool.id)).map(tool=>({label:tool.label,shortcut:command?'':tool.key,checked:tool.id===current,run:()=>{if(command){pianoCommandTool=tool.id;syncPianoToolMenus();}else setPianoTool(tool.id);}})));
}
function pianoLocalMenu(event,kind){
 activePianoCancel?.();const bounds=(event.currentTarget||event.target).getBoundingClientRect(),at={clientX:bounds.left,clientY:bounds.bottom},none=!selectedNotes.size;
 const items={
  edit:[['Undo','⌘Z',()=>undo()],['Redo','⇧⌘Z',()=>redo()],null,['Cut','⌘X',cutPianoNotes,none],['Copy','⌘C',copyPianoNotes,none],['Paste','⌘V',()=>pastePianoNotes({at:pianoCursor}),!pianoClipboard],['Delete','⌫',deletePianoSelection,none],['Repeat','⌘R',duplicatePianoNotes,none],null,['Select All','⌘A',selectAllPianoNotes],['Deselect All','⇧⌘A',()=>{clearPianoSelection();renderPiano();},none]],
  functions:[{label:`Quantize Selected Notes (${LOGIC_TIME_QUANTIZE.find(item=>item.id===pianoQuantize.grid)?.label||'Off'})`,shortcut:'Q',run:quantizePianoSelection},['Scale Quantize Selected Notes','',scaleQuantizePianoSelection,pianoQuantize.scaleRoot==='Off','Choose a Scale Quantize root in the inspector.'],['Quantize…','⌥Q',quantizePianoDialog],null,['Transpose +1 Octave','',()=>transformPianoNotes(notes=>PianoTools.transposeNotes(notes,12))],['Transpose −1 Octave','',()=>transformPianoNotes(notes=>PianoTools.transposeNotes(notes,-12))],['Note Overlap Correction (Legato)','',()=>transformPianoNotes(notes=>PianoTools.legatoNotes(notes,patternLengthBeats(pattern())))],{label:'MIDI Transform',submenu:[{label:'Humanize…',run:()=>openHumanizeDialog(dialog,{selection:selectedNotes.size,onApply:options=>transformPianoNotes(notes=>humanizeNotes(notes,options))})}]},null,['Split Notes at Playhead','',()=>restructurePianoNotes('slice')],['Glue Selected Notes','',()=>restructurePianoNotes('glue'),selectedNotes.size<2],['Mute Notes On/Off','⌃M',toggleSelectedNotesMuted,none],null,['Note Properties…','',()=>openNoteProperties(selectedNote||[...selectedNotes][0]),none],['Clear Region Notes','',()=>$('#piano-clear').click()]],
  view:[{label:'Other Tracks’ Notes (Ghosts)',checked:pianoGhostsEnabled,shortcut:'⌥V',run:togglePianoGhosts},{label:'Velocity Lane',checked:!$('#piano').classList.contains('hide-velocity'),run:()=>{$('#piano').classList.toggle('hide-velocity');}},{label:'Local Inspector',checked:!$('#piano').classList.contains('hide-inspector'),run:()=>{$('#piano').classList.toggle('hide-inspector');}},null,{label:'Zoom to Fit Selection',run:()=>setPianoTool('zoom')}],
 }[kind];
 menu(at,items);
}
function syncPianoInspector(){
 const grid=$('#piano-quantize-grid'),root=$('#piano-scale-root'),scale=$('#piano-scale-type');if(!grid)return;
 if(!grid.options.length)grid.innerHTML=LOGIC_TIME_QUANTIZE.map(item=>`<option value="${item.id}">${item.label}</option>`).join('');
 if(!root.options.length)root.innerHTML=LOGIC_SCALE_ROOTS.map(name=>`<option>${name}</option>`).join('');
 if(!scale.options.length)scale.innerHTML=Object.keys(LOGIC_SCALES).map(name=>`<option>${esc(name)}</option>`).join('');
 grid.value=pianoQuantize.grid;root.value=pianoQuantize.scaleRoot;scale.value=pianoQuantize.scale;scale.disabled=pianoQuantize.scaleRoot==='Off';
 $('#piano-quantize-strength').value=pianoQuantize.strength;$('#piano-quantize-strength-value').textContent=pianoQuantize.strength;$('#piano-quantize-swing').value=pianoQuantize.swing;$('#piano-quantize-swing-value').textContent=pianoQuantize.swing;
 const notes=(pattern().notes[channel().id]||[]).filter(n=>selectedNotes.has(n.id)),slider=$('#piano-velocity-slider');slider.disabled=!notes.length||!playlistEditable();
 if(notes.length&&document.activeElement!==slider){const values=notes.map(n=>midiVelocity(n.velocity)),low=Math.min(...values),high=Math.max(...values);slider.value=String(Math.round(values.reduce((a,b)=>a+b,0)/values.length));$('#piano-velocity-value').textContent=low===high?String(low):`${low}–${high}`;}else if(!notes.length)$('#piano-velocity-value').textContent='—';
 slider.title=notes.length?'Velocity of the selected notes':'Select notes to edit their velocity';
}
function renderAll(){laneCreateDialog?.syncScope();if(!project.channels.find(c=>c.id===selectedChannel))selectedChannel=project.channels[0].id;renderSummary();renderPatterns();renderRack();renderPlaylist();renderMixer();renderPiano();renderBrowser();}
const library=[['Current project',[['Patterns','patterns'],['History','history'],['Project info','info']]],['Plugin database',[['Cloud instruments','cloud'],['Plugin parameters','cloud'],['Instrument presets','cloud']]],['Packs',[['808 Kick','kick'],['808 Clap','clap'],['808 HiHat','hat'],['808 Snare','snare'],['Open Hat','openhat']]],['Audio files',[['Import audio…','import'],['Record microphone…','record']]],['Freestyle cloud',[['Cloud projects','cloud'],['Instruments & plugins','cloud'],['All MCP tools','cloud'],['Cloud exports…','publish']]]];
let browserTab='favorites',closedFolders=new Set(),cloudLibrary=null,cloudLibraryView=null;
function renderLegacyBrowser(){const query=$('#browser-search').value.toLowerCase();let groups=library;if(browserTab==='plugins')groups=library.slice(1,3);if(browserTab==='patterns')groups=[['Patterns',project.patterns.map(p=>[p.name,'pattern:'+p.id])]];if(browserTab==='cloud')groups=library.slice(4);if(browserTab==='favorites')groups=library.slice(1,2);
 $('#browser-tree').innerHTML=groups.map(([name,items],i)=>{const matches=items.filter(([title])=>title.toLowerCase().includes(query)||name.toLowerCase().includes(query));if(!matches.length)return '';return `<div class="browser-folder" data-folder="${esc(name)}"><span>${closedFolders.has(name)?'▸':'▾'}</span><span class="folder-icon">▰</span>${esc(name)}</div><div class="browser-items ${closedFolders.has(name)&&!query?'hidden':''}">${matches.map(([title,type])=>`<button class="browser-item" data-library="${esc(type)}" title="${esc(title)}"${type.startsWith('pattern:')?' draggable="true"':''}><span class="file-icon">${['kick','clap','hat','snare','openhat'].includes(type)?'≋':type==='cloud'?'☁':'♬'}</span>${esc(title)}${['bass','keys','pad','piano'].includes(type)?'<small>SYNTH</small>':''}</button>`).join('')}</div>`;}).join('');
 $$('.browser-folder').forEach(el=>el.onclick=()=>{const n=el.dataset.folder;closedFolders.has(n)?closedFolders.delete(n):closedFolders.add(n);renderBrowser();});
 if(browserTab==='patterns'){const b=document.createElement('button');b.className='browser-item';b.textContent='☁ Browse cloud pattern library';b.onclick=()=>{browserTab='pattern-library';renderBrowser();};$('#browser-tree').append(b);}
 $$('[data-library^="pattern:"]').forEach(el=>{el.ondragstart=e=>{e.dataTransfer.setData('application/vegetable-pattern',el.dataset.library.slice(8));e.dataTransfer.effectAllowed='copy';};});
 $$('[data-library]').forEach(el=>{el.onclick=()=>{const type=el.dataset.library;$('#browser-preview').textContent=el.textContent.trim();if(type==='cloud'){openCloudPanel().catch(fail);return;}if(type==='publish'){publishDialog();return;}if(type==='import'){importedTarget=null;$('#import-audio').click();return;}if(type==='record'){toggleRecord().catch(fail);return;}if(type==='patterns'){browserTab='patterns';renderBrowser();return;}if(type.startsWith('pattern:')){selectPattern(type.slice(8));return;}if(type==='history'){showHistory();return;}if(type==='info'){projectInfo();return;}const role={kick:'kick',clap:'clap',hat:'hat',snare:'snare',openhat:'open hat'}[type]||type,existing=project.channels.find(c=>c.type===type||c.name.toLowerCase().includes(role));if(existing)engine.preview(existing,['bass','pad'].includes(type)?36:60).catch(fail);else toast('Double-click to add this sound in Freestyle.');};el.ondblclick=()=>{const type=el.dataset.library;if(['bass','keys','pad','piano','kick','clap','hat','snare','openhat'].includes(type))addChannel(type,el.textContent.replace('SYNTH','').slice(1).trim());};});
}
function renderBrowser(){const views={all:'project-samples',plugins:'plugins',favorites:'sounds','pattern-library':'patterns',audio:'audio',kits:'kits',effects:'effects',packs:'packs'},view=views[browserTab];if(!view){if(cloudLibrary){cloudLibrary.destroy();cloudLibrary=null;cloudLibraryView=null;}renderLegacyBrowser();return;}
 if(!engine.ready){if(cloudLibrary)return;$('#browser-tree').innerHTML='<div class="browser-folder">▾　Current project</div><button class="browser-item" id="browser-connect-cloud">☁ Connect Freestyle library</button>';$('#browser-connect-cloud').onclick=()=>openCloudPanel().catch(fail);return;}
 if(!cloudLibrary){$('#browser-tree').replaceChildren();cloudLibrary=new CloudLibraryBrowser({catalogPreview:true/* Freestyle #16: previewCatalogSound */,getRegistrationScope:fileImportScope,getFeatureProject:()=>project,container:$('#browser-tree'),searchInput:$('#browser-search'),previewContainer:$('#browser-preview-dock'),monitor:engine.monitor,getProject:async()=>{assertRangeIdle();if(!engine.ready)throw new Error('Select a Freestyle cloud project first.');if(engine.interacting)throw new Error('Finish the current drag before adding library content.');await engine.flush();return project;},call:async(name,args)=>{if(['materialize_sound_pack_item','apply_marketplace_pattern'].includes(name)){assertRangeIdle();if(engine.interacting)throw new Error('Finish the current drag before adding library content.');await engine.flush();}return engine.session.call(name,args);},prepareMedia:prepareLibraryMedia,inspectMediaError:url=>inspectLibraryPreviewError(url),onWriteState:busy=>document.body.classList.toggle('cloud-library-writing',busy),onError:fail,onStatus:toast,onSampleMaterialized:addMaterializedSample,onPatternApply:async({projectId})=>{if(projectId!==engine.projectId)throw new Error('The pattern was applied to the previous cloud project. Return to that project to edit it.');const previous=new Set(project.patterns.map(p=>p.id));await engine.refresh();const added=project.patterns.filter(p=>!previous.has(p.id));if(added.length===1)selectPattern(added[0].id);},onAuditionSample:({audioFileId})=>engine.previewSampleFile(audioFileId),onPreview:async item=>{$('#browser-preview').textContent=item.name||'Cloud sound';$('#browser-wave').innerHTML='<text x="0" y="27" fill="currentColor" font-size="9">CLOUD AUDIO PREVIEW</text>';const id=item.audioFileId||item.audio_file_id,existing=id&&project.channels.find(c=>c.audioFileId===id);if(existing){await engine.preview(existing);return true;}return false;}}).mount();}
 if(cloudLibraryView!==view){cloudLibraryView=view;cloudLibrary.open(view).catch(fail);}}
async function prepareLibraryMedia(url){try{return await prepareFreestyleMedia(url);}catch(error){throw new Error(error?.detail||error?.message||'Cloud media authorization is unavailable.');}}
async function addMaterializedSample({projectId,targetPatternId,source,guard=()=>{}}){
 const check=()=>{guard();if(projectId!==engine.projectId||!engine.ready)throw new Error('The sample belongs to the previous cloud project. Return to that project to add it to a pattern.');};check();await engine.flush();check();
 if(pattern().id==='empty'){const p={id:'local-'+uid(),name:'Pattern 1',bars:1,steps:{},notes:{},cloudSources:{}};project.patterns=[p];project.selectedPattern=p.id;changed();await engine.flush();check();}
 const p=targetPatternId&&targetPatternId!=='empty'?project.patterns.find(p=>p.id===targetPatternId):pattern();if(!p)throw new Error('The sample is in the cloud pool, but its original target pattern no longer exists.');
 const c=attachPatternSampleSource(project,p,source);selectedChannel=c.id;project.selectedPattern=p.id;engine.selectedPattern=p.id;changed();await engine.flush();check();
}
const rackSampleRegistration=new CloudPatternSampleRegistration({call:(name,args,options)=>engine.session.call(name,args,options),getScope:fileImportScope});
async function addAudioClipToRack(clip){
 assertRangeIdle();if(!coreFileEditable()||engine.interacting)throw new Error('Finish the current edit before adding a sample.');const targetPatternId=pattern().id;if(!project.patterns.some(p=>p.id===targetPatternId&&p.cloudId))throw new Error('Create and select a saved pattern before adding a clip to the Channel Rack.');
 const scope=JSON.stringify(fileImportScope()),guard=()=>{if(scope!==JSON.stringify(fileImportScope())||!engine.ready||engine.loading||!project.patterns.some(p=>p.id===targetPatternId))throw new Error('The sample target changed. Inspect the original project before adding it again.');};rackRegistrationBusy=true;let registered;
 try{await engine.flush();guard();registered=await rackSampleRegistration.registerClip(clip,{targetPatternId,name:Array.from(clip.name||'Sample').slice(0,80).join(''),guard});if(registered.record.attachmentConfirmed){toast(`${registered.sample.name} is already in the Channel Rack.`);return registered;}if(registered.record.attachmentAttempted)throw new Error('The sample registration is retained, but its pattern attachment is unconfirmed. Inspect the target pattern before another attempt.');registered.record.attachmentAttempted=true;registered.record.status='attaching';await addMaterializedSample({...registered,guard});guard();const target=project.patterns.find(p=>p.id===targetPatternId),confirmed=target?.cloudRaw?.pattern?.sources?.some(source=>source.id===registered.source.id&&source.audioFileId===registered.source.audioFileId);if(!confirmed)throw new Error('The saved pattern has not confirmed the registered sample source. Inspect it before adding another.');registered.record.attachmentConfirmed=true;registered.record.status='attached';toast(`${registered.sample.name} added to the Channel Rack.`);return registered;}catch(error){if(registered){registered.record.error=error;registered.record.status='attachment_unconfirmed';error.message=`Sample registered; Channel Rack attachment unconfirmed. ${error.message}`;}throw error;}finally{rackRegistrationBusy=false;mixerView?.render();}
}
// 308 disk file -> Channel Rack: sample-only upload, then the existing canonical
// source attachment. No Playlist lane/take/clip and no score events are created.
const rackSampleUpload=new CloudPatternSampleUpload({getScope:fileImportScope});
const RACK_UPLOAD_TARGET='vegetable-rack-upload';
function rackUploadSupported(){return project.cloud?.rawState?.studioApi===true&&uiFeature('rack_file_upload').enabled;}
function playlistSamplePlacementSupported(){return project.cloud?.rawState?.studioApi===true&&uiFeature('playlist_sample_place').enabled;}
async function uploadFilesToRack(files,{check=()=>{},beginWrite=()=>{}}={}){
 if(!rackUploadSupported())throw new Error('Direct disk-to-Rack upload needs a Freestyle Studio API project. Import audio into the Playlist, then choose Add to Channel Rack from its clip menu.');
 // Callers own the workspace fence (the file-drop operation itself is busy here).
 if(rangeBusy())throw new Error('Wait for the current audio range request to finish.');if(engine.interacting)throw new Error('Finish the current edit before adding a sample.');
 const targetPatternId=pattern().id;if(!project.patterns.some(p=>p.id===targetPatternId&&p.cloudId))throw new Error('Create and select a saved pattern before adding samples to the Channel Rack.');
 const scope=JSON.stringify(fileImportScope()),guard=()=>{check();if(scope!==JSON.stringify(fileImportScope())||!engine.ready||engine.loading||!project.patterns.some(p=>p.id===targetPatternId))throw new Error('The sample target changed. Inspect the original project before adding it again.');};
 rackRegistrationBusy=true;const results=[];
 try{
  await engine.flush();guard();
  for(const file of files){
   guard();beginWrite();toast(`Uploading ${file.name} to the Channel Rack…`);
   results.push(await rackSampleUpload.upload(file,{targetPatternId,guard,attach:async payload=>{await addMaterializedSample({...payload,guard:payload.guard});guard();const target=project.patterns.find(p=>p.id===targetPatternId),confirmed=target?.cloudRaw?.pattern?.sources?.some(source=>source.id===payload.source.id&&source.audioFileId===payload.source.audioFileId);if(!confirmed)throw new Error('The saved pattern has not confirmed the uploaded sample source. Inspect it before adding another.');}}));
  }
  const reused=results.filter(result=>result.existing).length,message=results.length===1?`${results[0].source.name} added to the Channel Rack${reused?' (same audio already stored; nothing new uploaded)':''}.`:`${results.length} samples added to the Channel Rack${reused?` (${reused} already stored)`:''}.`;toast(message);$('#hint').textContent=message;return results;
 }catch(error){const status=error.patternSampleUpload?.status;if(status==='attachment_unconfirmed')error.message=`Sample uploaded; Channel Rack attachment unconfirmed. ${error.message}`;else if(status==='upload_uncertain')error.message=`The Channel Rack upload outcome is unknown. ${error.message} Inspect the project sample pool before adding it again.`;else if(status==='uploaded')error.message=`Sample stored in the project sample pool but not added to the Channel Rack. ${error.message}`;throw error;}
 finally{rackRegistrationBusy=false;mixerView?.render();}
}
// 308 stored sample (Browser or Rack) -> Playlist audio clip with retained
// import-style history: one new clip plus an optional owned new lane.
const samplePlacement=new CloudSamplePlacement({getScope:fileImportScope});
let samplePlacementBusy=false;
/** Browser catalog sound -> registered project sample, per project. Registration
 * is idempotent server-side; a cached audioFileId only skips the repeat round
 * trip and is dropped if Freestyle later rejects it. */
const placementSampleCache=new Map();
async function placeSampleWithHistory(sample,{laneId,startMs},{mark=()=>{},cachedBefore=false,onPlaced=null}={}){
 if(engine.session.rawState?.studioApi!==true)throw new Error('Playlist sample placement needs a Freestyle Studio API project.');
 await engine.flush();const scope=fileImportScope(),assert=()=>{if(JSON.stringify(scope)!==JSON.stringify(fileImportScope())||!engine.ready||engine.loading)throw Object.assign(new Error('The project changed during sample placement.'),{name:'AbortError'});};
 const read=async()=>{assert();const result=await engine.session.call('get_project',{project_id:scope.projectId});assert();const saved=projectPlaylistCloneRead(engine,result,scope);engine.session.rawProject=saved.rawProject;engine.session.rawState=saved.rawState;engine.session.project=saved.project;engine.accept(saved.project);};
 // Registration (if any) already happened; this read is the history before-state.
 // With cachedBefore, the last confirmed saved state is the before-state: the
 // placement's If-Match on its ETag proves it is current (a stale one is a 412
 // with nothing placed, and the caller then reads and retries once).
 mark('flushed');const makeController=()=>new AudioImportHistoryController({before:project,getProject:()=>project,getSaved:()=>engine.session.project,getScope:fileImportScope,read,call:(...args)=>engine.session.call(...args),flush:()=>engine.flush(),onChange:()=>mixerView?.render()});let controller=null,usedCachedBefore=false;
 if(cachedBefore&&project?.cloud?.rawProject?.id===scope.projectId&&!engine.applying&&!engine.interacting){try{controller=makeController();controller.revision(controller.before);usedCachedBefore=true;mark('cached-before');}catch{controller=null;}}
 if(!controller){await read();mark('before-read');assert();controller=makeController();}
 const history=engine.patternHistory,token=history.beginAudioImport(controller);let result;
 try{
  const ifMatch=controller.revision(controller.before);
  result=await samplePlacement.place({audioFileId:sample.audioFileId,startMs,...(laneId?{laneId}:{}),...(sample.name?{name:sample.name}:{}),...(sample.rackChannelId?{rackChannelId:sample.rackChannelId}:{})},{ifMatch,guard:assert});mark('placed');assert();
  // Presentation hooks (row binding) run before the canonical read renders the result.
  try{onPlaced?.(result);}catch{}
  await controller.fresh();mark('after-read');controller.adopt({after:project,clipId:result.clipId});mark('adopted');history.finishAudioImport(token);audioRangeRevision++;return result;
 }catch(error){
  const committed=!!result||error.operationCommitted===true,attempted=!!result||error.operationAttempted===true,explicitRejection=error.explicitRejection===true;
  controller.failImport({attempted,committed,uncertain:error.operationUncertain===true||attempted&&!committed&&!explicitRejection,explicitRejection,error});history.failAudioImport(token,error);
  if(committed)error.message=`Sample placed and saved; its Undo history is unconfirmed. ${error.message} Inspect the Playlist before placing it again.`;error.placementUsedCachedBefore=usedCachedBefore;throw error;
 }
}
function libraryPlaylistDropTarget(event){const target=fileDropTarget(event);return target?.zone==='playlist'?target:null;}
function playlistDropGeometry(grid){try{const node=[...$$('.lane-grid .clip[data-clip]')][0],clip=node?findClip(node.dataset.clip):null,host=node?.closest('.lane-grid');return playlistGeometryProbe({grid,ruler:$('#timeline-ruler'),barWidth,clip:clip&&host?{element:node,start:clip.start,grid:host}:null});}catch{return null;}}
function playlistDropGridFor(event,track){return(Number.isInteger(track)?$(`.lane-grid[data-track="${track}"]`):null)||event.target?.closest?.('.lane-grid')||null;}
/** Client diagnostics: pointer x -> beat -> snapped beat and the target row/lane of a Playlist drop. */
function playlistDropRecordFor(event,source,target={}){try{const grid=playlistDropGridFor(event,target.track),left=grid?playlistGridOrigin(grid):$('#arrangement').getBoundingClientRect().left+PLAYLIST_GUTTER;return{geometry:grid?playlistDropGeometry(grid):null,...playlistDropRecord({source,clientX:event.clientX,left,barWidth,snap:event.altKey?0:+$('#snap').value,track:Number.isInteger(target.track)?target.track:null,laneId:target.laneId||null,createLane:!target.laneId}),targetBeat:Number.isFinite(target.beat)?target.beat:null,bpm:project.bpm,projectId:engine.projectId||null};}catch(error){return{source,error:String(error?.message||error).slice(0,200)};}}
/** Optimistic Playlist feedback: a provisional clip at the drop cell while the
 * cloud placement is pending. Presentation only (not in the project model, never
 * saved); removed when the canonical clip arrives or the drop fails. */
function showPendingPlaylistClip(target,raw){try{const grid=playlistDropGridFor({},target.track),host=$('#arrangement');if(!grid||!host||!Number.isFinite(target.beat))return null;let item={};try{item=JSON.parse(raw)||{};}catch{}const seconds=[item.durationSec,item.duration_sec,item.duration,item.lengthSec].map(Number).find(value=>Number.isFinite(value)&&value>0),beats=seconds?seconds*project.bpm/60:1,g=grid.getBoundingClientRect(),h=host.getBoundingClientRect(),el=document.createElement('div');el.className='clip playlist-pending-clip';el.setAttribute('aria-hidden','true');el.style.cssText=`left:${g.left-h.left+target.beat*barWidth/4}px;top:${g.top-h.top+1}px;width:${Math.max(12,beats*barWidth/4)}px;height:${Math.max(12,g.height-3)}px;pointer-events:none;z-index:11`;el.innerHTML=`<div class="clip-title">${esc(String(item.name||'Sample').slice(0,120))} · placing…</div>`;host.append(el);return el;}catch{return null;}}
/** Keep the provisional clip until the adopted clip is actually rendered (a
 * Playlist re-render may land a frame after adoption); re-attach it if a render
 * detaches it meanwhile. A failed drop (no clip id) removes it at once. */
function settlePendingPlaylistClip(ghost,clipId,{timeoutMs=4000,onSettled=()=>{}}={}){
 if(!ghost)return null;const host=$('#arrangement'),rendered=()=>!!clipId&&[...document.querySelectorAll('#track-lanes .clip[data-clip]')].some(node=>node.dataset.clip===clipId);
 let observer=null,timer=null,done=false;const finish=reason=>{if(done)return;done=true;observer?.disconnect();clearTimeout(timer);ghost.remove();try{onSettled({reason});}catch{}};
 if(!clipId||!host)return finish(clipId?'no-host':'no-clip'),null;if(rendered())return finish('rendered'),null;
 try{observer=new MutationObserver(()=>{if(rendered())return finish('rendered');if(!ghost.isConnected&&host.isConnected)host.append(ghost);});observer.observe(host,{childList:true,subtree:true});}catch{}
 timer=setTimeout(()=>finish('timeout'),timeoutMs);return{finish};
}
/** FL: a lane created by a Playlist drop takes the dropped row. A row can look empty yet hold a lane
 * that cannot host audio (live 859daf row 6: an empty instrument track); the created lane is then
 * inserted above that lane instead of being appended below every lane. Called with the placement /
 * upload result BEFORE the canonical after-read renders it. Returns the playlist-drop-row record. */
const recentDropRows=new Map();/* laneId → {row, at, projectId}: lanes a drop bound that the next read has not rendered yet */
/** The row a new-lane drop lands on: never below the last track (or the rows earlier drops already bound). */
function clampedPlaylistDropRow(row,exceptLaneId=null){
 if(!Number.isInteger(row)||row<0)return row;
 const shown=project.cloud?.timelineLaneIds||[],now=Date.now(),pendingRows=[...recentDropRows].filter(([id,entry])=>id!==exceptLaneId&&!shown.includes(id)&&entry.projectId===engine.projectId&&entry.loadVersion===(engine.loadVersion||0)&&now-entry.at<60000).map(([,entry])=>entry.row+1),end=Math.max(shown.findLastIndex(id=>!!id)+1,...pendingRows);
 return Math.min(row,end);
}
function bindPlaylistDropRow(placed,row,{source,file=null}={}){
 if(!placed?.createdLane||!placed.laneId||!Number.isInteger(row)||row<0)return null;
 /* QA r6: Live has no empty rows between tracks. A drop on the empty space below the last track lands right after it
    (and after lanes this drop already bound), never leaving a phantom "Track N" gap row above it. */
 const now=Date.now(),requested=row;row=clampedPlaylistDropRow(row,placed.laneId);recentDropRows.set(placed.laneId,{row,at:now,projectId:engine.projectId,loadVersion:engine.loadVersion||0});
 const occupant=project.cloud?.timelineLaneIds?.[row]||null;setLaneRowHint(engine.projectId,placed.laneId,row,{insert:!!occupant});
 return{source,...(file==null?{}:{file}),intendedRow:row,...(requested!==row?{droppedRow:requested}:{}),laneId:placed.laneId,occupantLaneId:occupant,insert:!!occupant,hintStored:laneRowHints(engine.projectId).get(placed.laneId)??null};
}
/** Live proof of a new-lane drop: the intended row, the created lane, the stored hint and where it rendered. */
function playlistDropRowRecord(row,clipId){try{const rows=project.cloud?.timelineLaneIds||[],node=clipId?[...document.querySelectorAll('#track-lanes .clip[data-clip]')].find(item=>item.dataset.clip===clipId):null,dom=node?.closest('.lane-grid')?.dataset.track;const renderedRow=rows.indexOf(row.laneId);return{...row,clipId:clipId||null,hintNow:laneRowHints(engine.projectId).get(row.laneId)??null,renderedRow:renderedRow<0?null:renderedRow,renderedDomRow:dom==null?null:Number(dom),occupantRowNow:row.occupantLaneId?rows.indexOf(row.occupantLaneId):null,matches:renderedRow===row.intendedRow,laneCount:rows.filter(Boolean).length};}catch(error){return{...row,error:String(error?.message||error).slice(0,200)};}}
async function dropLibrarySoundOnPlaylist(event){
 const raw=event.dataTransfer?.getData?.(LIBRARY_SOUND_MIME),target=raw?libraryPlaylistDropTarget(event):null;if(!target)return false;event.preventDefault();event.stopPropagation();$('#arrangement-scroll').classList.remove('library-drop-target');
 const t0=performance.now(),timing=[],mark=name=>timing.push([name,Math.round(performance.now()-t0)]),ghost=showPendingPlaylistClip(target,raw);clientLog('playlist-drop',playlistDropRecordFor(event,'library-sound',target));let outcome='failed',placedClipId=null,dropRow=null;
 try{
 if(!playlistSamplePlacementSupported())return toast(uiFeature('playlist_sample_place').reason||'Playlist sample placement needs a Freestyle Studio API project.');
 // Queue behind an in-flight cloud operation (another drop, mixer write, clip mute…) instead of refusing.
 try{await waitForCloudIdle('Playlist sample drop',{onQueued:()=>toast('Sample drop queued; it will be placed when the current cloud operation finishes.')});}catch(error){fail(error);return null;}mark('idle');
 if(!playlistSamplePlacementSupported())return toast(uiFeature('playlist_sample_place').reason||'Playlist sample placement needs a Freestyle Studio API project.');
 samplePlacementBusy=true;
 try{
  const item=parseLibrarySoundDrag(raw),scope=JSON.stringify(fileImportScope()),check=()=>{if(scope!==JSON.stringify(fileImportScope())||!engine.ready||engine.loading)throw new Error('The project changed before the sample was placed.');};let sample;
  if(item._libraryView==='rack-channel'){const channel=project.channels.find(c=>String(c.id)===item.channelId),payload=rackSampleDragPayload(channel,engine.projectId);if(!payload||item.projectId!==engine.projectId||payload.audioFileId!==item.audioFileId)throw new Error('This Rack channel changed. Drag it again from the current Channel Rack.');sample={audioFileId:payload.audioFileId,name:payload.name,...(payload.rackChannelId?{rackChannelId:payload.rackChannelId}:{})};}
  const cacheKey=item._libraryView==='rack-channel'||item._libraryView==='project-samples'?null:`${engine.projectId}|${item.id}`;let sampleFromCache=false;
  const resolveCatalog=async()=>{if(!cloudLibrary)throw new Error('Open the Freestyle Browser before dragging its sounds.');toast(`Preparing ${item.name||'sample'} for the Playlist…`);const resolved=await cloudLibrary.resolvePlacementSample(item);mark('resolved');check();if(resolved.projectId!==engine.projectId)throw new Error('The sample belongs to the previous cloud project.');sample={audioFileId:resolved.audioFileId,name:resolved.name};if(cacheKey)placementSampleCache.set(cacheKey,{...sample});};
  if(item._libraryView!=='rack-channel'){const cached=cacheKey?placementSampleCache.get(cacheKey):null;if(cached){sample={...cached};sampleFromCache=true;mark('resolved-cached');}else await resolveCatalog();}
  await engine.flush();check();const beat=target.beat;if(typeof beat!=='number'||!Number.isFinite(beat)||beat<0)throw new Error('Choose a valid Playlist drop position.');
  const startSeconds=project.cloud?.rawProject?.timingMap?.isConstantTempo===false?(await timingMap.convert({beat})).seconds:beat*60/project.bpm;check();if(typeof startSeconds!=='number'||!Number.isFinite(startSeconds)||startSeconds<0)throw new Error('Freestyle did not confirm the sample drop time.');
  toast(`Placing ${sample.name||'sample'} on the Playlist…`);// FL: a drop on an empty (lane-less) row binds the created lane to that row. The hint is set as soon as the
  // lane id is known, before the after-read renders it, so the clip never appears appended at the bottom first.
  const bindRow=placed=>{const bound=bindPlaylistDropRow(placed,target.track,{source:'library-sound'});if(bound)dropRow=bound;};
  const place=options=>placeSampleWithHistory(sample,{laneId:target.laneId||undefined,startMs:Math.round(startSeconds*1000)},{mark,onPlaced:bindRow,...options});let result;
  try{result=await place({cachedBefore:true});}
  catch(error){
   // Nothing was placed in either case below, so one retry is safe.
   if(error.explicitRejection===true&&error.placementUsedCachedBefore&&error.samplePlacement?.status==='conflict'){mark('stale-before-retry');result=await place({cachedBefore:false});}
   else if(error.explicitRejection===true&&sampleFromCache&&[400,404,410,422].includes(error.status)){placementSampleCache.delete(cacheKey);mark('stale-sample-retry');await resolveCatalog();result=await place({cachedBefore:true});}
   else throw error;
  }
  outcome=result.createdLane?'placed-new-lane':'placed';placedClipId=result.clipId||null;
  const message=result.engineReloadRequired?`${sample.name||'Sample'} is saved on the Playlist, but the live session did not load it. Reload the cloud session to hear it; do not place it again.`:`${sample.name||'Sample'} placed on the Playlist${result.createdLane?' in a new audio lane':''}.`;toast(message);$('#hint').textContent=message;return result;
 }catch(error){fail(error);return null;}finally{samplePlacementBusy=false;mixerView?.render();}
 }finally{settlePendingPlaylistClip(ghost,placedClipId,{onSettled:info=>{clientLog('playlist-drop-ghost',{clipId:placedClipId,...info,sinceDropMs:Math.round(performance.now()-t0)});if(dropRow)clientLog('playlist-drop-row',playlistDropRowRecord(dropRow,placedClipId));}});if(dropRow&&!ghost)clientLog('playlist-drop-row',playlistDropRowRecord(dropRow,placedClipId));clientLog('playlist-drop-timing',{source:'library-sound',outcome,track:target.track,laneId:target.laneId||null,stages:timing,totalMs:Math.round(performance.now()-t0)});}
}
function bindRackSampleDrag(row,channel){
 const name=row.querySelector('.channel-name'),payload=playlistSamplePlacementSupported()?rackSampleDragPayload(channel,engine.projectId):null;if(!name)return;name.draggable=!!payload;if(!payload)return;
 name.ondragstart=event=>{const fresh=coreFileEditable()&&!samplePlacementBusy?rackSampleDragPayload(project.channels.find(c=>c.id===channel.id),engine.projectId):null;if(!fresh){event.preventDefault();return;}event.dataTransfer.effectAllowed='copy';event.dataTransfer.setData(LIBRARY_SOUND_MIME,JSON.stringify(fresh));event.dataTransfer.setData('text/plain',fresh.name);};
}
async function addChannel(type='keys',name){
 if(workspaceBusy())return toast('Wait for the current cloud operation to finish.');if(rangeBusy())return toast('Wait for the current audio range request to finish.');if(!engine.ready){openCloudPanel().catch(fail);return;}
 try{
  const drum=['kick','clap','hat','snare','openhat'].includes(type);await engine.flush();assertRangeIdle();
  if(!drum&&project.cloud?.rawState?.studioApi===true){requireUiFeature('create_instrument');return laneCreateDialog.open({kind:'instrument',name:name||''});}
  requireUiFeature(drum?'add_drum_channel':'create_instrument');toast('Adding a channel in Freestyle…');
  if(drum)await engine.session.setSteps(pattern(),{name:name||({kick:'Kick',clap:'Clap',hat:'Hi Hat',snare:'Snare',openhat:'Open Hat'}[type]),soundQuery:name||type},Array(16).fill(false),{replace:false});else await engine.session.addInstrument(type==='bass'?'synth_bass':type,name||type);
  // Both typed actions already refresh canonical project state after their acknowledgement.
  toast('Cloud channel added.');
 }catch(error){fail(error);}
}
function showWindow(id,force=true){activePianoCancel?.();activeRackCancel?.();activePlaylistCancel?.();const win=$('#'+id);if(force)win.classList.remove('hidden');else win.classList.toggle('hidden',windows.toggleAction(win)==='hide');if(!win.classList.contains('hidden')){windows.raise(win);win.classList.add('front');if(id==='piano'){renderPiano();}if(id==='mixer')requestMixerInspection();}$$(`[data-window="${id}"]`).forEach(b=>b.classList.toggle('lit',!win.classList.contains('hidden')));if(editorKindForWindow(id))syncEditorPane(id);else if(id==='mixer')syncMixerDock();}
$$('[data-window]').forEach(b=>b.onclick=()=>showWindow(b.dataset.window,false));
let pianoMaximizedView=null;
const windows=new WindowManager({bounds:$('#desktop'),onDragState:(active,win)=>{document.body.classList.toggle('window-moving',active);if(active&&win.id==='piano'){pianoMaximizedView=null;syncPianoMaximizeButton();}if(!active){lastTickKey='';if(queuedProject){const next=queuedProject;queuedProject=null;applyProjectUi(next);}updateTick(engine.positionAt());animate();}}});
for(const id of ['rack','mixer','piano','playlist'])windows.register($('#'+id));windows.watchDialogs();
// Capture before WindowManager raises the target: entering a visible Mixer is
// an explicit read request, while startup render/accept never starts one.
for(const event of ['pointerdown','focusin'])document.addEventListener(event,e=>{if(e.target.closest?.('#mixer')&&!e.target.closest?.('input,button,.mixer-pan'))requestMixerInspection();},true);
const activeEditor=()=>windows.focusedWindow?.id||null;
const timelineViewport=new TimelineViewport({element:$('#arrangement-scroll'),getScale:()=>barWidth,setScale:value=>{barWidth=value;document.documentElement.style.setProperty('--bar',`${value}px`);},gutter:PLAYLIST_GUTTER,min:4,canZoom:()=>!engine.interacting,onZoom:()=>{lastTickKey='';renderTimelineGeometry();updateTick(engine.positionAt());}});
playlistNavigator=new PlaylistNavigator({element:$('#playlist-navigator'),viewport:$('#arrangement-scroll'),getScale:()=>barWidth,setView:({scale,scrollLeft})=>{barWidth=scale;document.documentElement.style.setProperty('--bar',`${scale}px`);lastTickKey='';renderTimelineGeometry();$('#arrangement-scroll').scrollLeft=scrollLeft;updateTick(engine.positionAt());},getClips:allClips,getSelected:()=>playlistSelection.ids,gutter:PLAYLIST_GUTTER,canNavigate:()=>!engine.interacting});
const pianoViewport=new TimelineViewport({element:$('#piano-scroll'),getScale:()=>pianoBarWidth,setScale:value=>{pianoBarWidth=value;document.documentElement.style.setProperty('--piano-bar',`${value}px`);renderPianoRuler();},gutter:PIANO_KEY_WIDTH,min:40,max:896,canZoom:()=>!engine.interacting,onZoom:()=>{lastTickKey='';updateTick(engine.positionAt());pianoNavigator?.refresh();}});
pianoNavigator=attachPianoNavigator({element:$('#piano-navigator'),viewport:$('#piano-scroll'),getScale:()=>pianoBarWidth,setView:view=>pianoViewport.setView(view),getNotes:()=>pattern().notes?.[channel().id]||[],getSelected:()=>selectedNotes,canNavigate:()=>!engine.interacting});
function zoomEditorPage({editor,direction}){
 if(!['playlist','piano'].includes(editor)||activeEditor()!==editor||$('#'+editor).classList.contains('hidden')||engine.interacting||windows.dragging||windows.pending||activePlaylistCancel||activePianoCancel||activeRackCancel||timelineViewport.pan||pianoViewport.pan)return false;
 // Measured native Piano Page keys retain the leftmost musical time, including when
 // scrolled, and advance about 1.17x per level; they do not follow the mouse.
 const viewport=editor==='playlist'?timelineViewport:pianoViewport;
 viewport.zoomBy(direction>0?1.17:1/1.17,0);return true;
}
const pianoFrameProperties=['left','top','right','bottom','width','height','transform','position','margin','will-change'];
function syncPianoMaximizeButton(){const expanded=$('#piano').classList.contains('expanded'),button=$('#piano-expand');button.title=expanded?'Restore piano roll':'Maximize piano roll';button.setAttribute('aria-label',button.title);button.setAttribute('aria-pressed',String(expanded));}
function togglePianoMaximize(){
 const win=$('#piano'),viewport=$('#piano-scroll'),width=viewport.clientWidth-PIANO_KEY_WIDTH;
 if(win.classList.contains('hidden')||width<=0)return false;
 activePianoCancel?.();if(engine.interacting||windows.dragging)return false;
 if(windows.pending?.window===win)windows.finish();windows.raise(win);
 if(win.classList.contains('expanded')){
  const before=pianoMaximizedView;pianoMaximizedView=null;win.classList.remove('expanded');
  if(before){for(const [key,value,priority]of before.frame)win.style.setProperty(key,value,priority);applyPianoView(before.view);}
 }else{
  const before={view:pianoView(),frame:pianoFrameProperties.map(key=>[key,win.style.getPropertyValue(key),win.style.getPropertyPriority(key)])};
  for(const key of pianoFrameProperties)win.style.removeProperty(key);win.classList.add('expanded');
  const nextWidth=viewport.clientWidth-PIANO_KEY_WIDTH;
  if(nextWidth<=0){win.classList.remove('expanded');for(const [key,value,priority]of before.frame)win.style.setProperty(key,value,priority);return false;}
  pianoMaximizedView=before;
  const scale=Math.max(pianoViewport.min,Math.min(pianoViewport.max,before.view.scale*nextWidth/width));
  pianoViewport.setView({scale,scrollLeft:before.view.scrollLeft*scale/before.view.scale,scrollTop:before.view.scrollTop});
 }
 $('#velocity-grid').scrollLeft=viewport.scrollLeft;pianoNavigator?.refresh();syncPianoMaximizeButton();return true;
}
$('#piano>.panel-heading').addEventListener('dblclick',event=>{if(event.button!==0||event.target.closest('button,input,select,textarea,a,summary,[contenteditable],[role="button"],[data-no-drag]:not(.panel-heading),.piano-tools,.panel-actions'))return;if(togglePianoMaximize()){event.preventDefault();event.stopPropagation();}});
syncPianoMaximizeButton();
let keyboardClipNodes=new Map(),keyboardClipTransforms=new Map();
const playlistKeyboard=new PlaylistKeyboardGesture({getProject:()=>project,getSelectedIds:()=>playlistSelection.ids,getSnap:()=>+$('#snap').value,getMaxTrack:()=>$$('.track-lane').length-1,getScope:()=>({load:engine.loadVersion,context:engine.session.contextVersion}),getContext:()=>({pianoActive:activeEditor()==='piano',dialogOpen:shortcutDialogOpen(),playlistActive:activeEditor()==='playlist'}),canStart:()=>!engine.interacting&&!windows.dragging&&playlistEditable(),canContinue:()=>!rangeBusy()&&!sliceBusy()&&!engine.loading&&!engine.editBlocked&&!windows.dragging,onStart:({selectedIds})=>{keyboardClipNodes=new Map($$('#playlist .clip[data-clip]').filter(node=>selectedIds.has(node.dataset.clip)).map(node=>[node.dataset.clip,node]));keyboardClipTransforms=new Map([...keyboardClipNodes].map(([id,node])=>[id,node.style.transform]));engine.interacting=true;activePlaylistCancel=()=>playlistKeyboard.cancel();},paint:({initial,clips,selectedIds})=>{const before=new Map(initial.map(clip=>[String(clip.id),clip]));for(const clip of clips){const id=String(clip.id),node=keyboardClipNodes.get(id),original=before.get(id);if(!node||!selectedIds.has(id))continue;const rowHeight=node.closest('.track-lane')?.getBoundingClientRect().height||playlistLaneHeight;node.style.transform=`translate3d(${(clip.start-original.start)*barWidth/4}px,${(clip.track-original.track)*rowHeight}px,0)`;}},restore:()=>{for(const [id,node]of keyboardClipNodes)node.style.transform=keyboardClipTransforms.get(id);keyboardClipNodes.clear();keyboardClipTransforms.clear();},onFinish:()=>{activePlaylistCancel=null;engine.interacting=false;},commit:({clips,selectedIds})=>{for(const clip of clips){if(!selectedIds.has(String(clip.id)))continue;const original=findClip(clip.id);if(original)Object.assign(original,{start:clip.start,track:clip.track});}changed();},onBlocked:toast,onError:fail});
window.addEventListener('beforeunload',()=>playlistKeyboard.destroy(),{once:true});

playlistLoop=new PlaylistLoopRegion({ruler:$('#timeline-ruler'),viewport:$('#arrangement-scroll'),engine,getProject:()=>project,getScale:()=>barWidth,getSnap:()=>Number($('#snap').value),dialog,onError:fail,onGestureEnd:()=>{if(engine.pending)engine.update(engine.pending);},onChanged:()=>{lastLoopKey='';renderPlaylist();updateTick(engine.positionAt());toast('Loop change acknowledged by Freestyle.');}});
const arrangementScroll=$('#arrangement-scroll');
function syncPlaylistCursorViewport(){
 $('#arrangement').style.setProperty('--playlist-scroll-y',`${arrangementScroll.scrollTop}px`);
 for(const id of ['edit-playhead','song-playhead']){const head=$('#'+id),x=Number(head.dataset.timelineX||0);head.style.visibility=x+.5<arrangementScroll.scrollLeft?'hidden':'visible';}
}
arrangementScroll.addEventListener('scroll',()=>{syncPlaylistCursorViewport();queueCloudWaveforms(120);},{passive:true});
function setPlaylistCursor(beat){editCursorBeat=Math.max(0,Number(beat)||0);lastTickKey='';updateTick(engine.positionAt());}
function playlistHome(){return playlistCursorJump(0);}
/** Move the Tracks playhead / edit cursor to `beat` (Logic Return, comma / period). */
function playlistCursorJump(beat){
 if(!engine.ready||engine.loading||engine.applying||engine.session.closed||engine.session.projectId!==engine.projectId||engine.interacting||windows.dragging||activePlaylistCancel||activePianoCancel||activeRackCancel||workspaceBusy()||rangeBusy()||sliceBusy()||engine.playAttempt||engine.previewing||modeSwitchPending||stopRequest)return;
 const target=Math.max(0,Number(beat)||0);setPlaylistCursor(target);try{Promise.resolve(engine.seek(target)).catch(fail);}catch(error){fail(error);}
}
$('#arrangement-scroll').addEventListener('contextmenu',event=>{if(tool==='zoom'&&event.target.closest('.lane-grid,.clip'))event.preventDefault();});
// FL: the whole Playlist track header column never shows the browser menu; a playlist track name opens the track menu.
$('#arrangement-scroll').addEventListener('contextmenu',event=>{const label=event.target.closest?.('.track-label'),gutter=!label&&!event.target.closest?.('.lane-grid,.clip,#timeline-ruler')&&event.clientX<$('#arrangement-scroll').getBoundingClientRect().left+PLAYLIST_GUTTER;if(!label&&!gutter)return;event.preventDefault();if(!label||label.classList.contains('automation-track-label')||!label.closest('#track-lanes > .track-lane'))return;event.stopPropagation();try{playlistTrackMenu(event,+label.dataset.track);}catch(error){fail(error);}});
$('#arrangement-scroll').addEventListener('pointerdown',event=>{
 if(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.target.closest('.track-label,.clip-resize,.clip-trim-start')||!event.target.closest('#timeline-ruler,.lane-grid,.clip'))return;
 // Logic: only the ruler moves the playhead; clicking track space or automation lanes just (de)selects.
 if(!event.target.closest('#timeline-ruler'))return;
 const rawBeat=Math.max(0,(event.clientX-$('#arrangement').getBoundingClientRect().left-PLAYLIST_GUTTER)/barWidth*4),beat=event.altKey?rawBeat:quantize(rawBeat);
 setPlaylistCursor(beat);
 if(event.target.closest('#timeline-ruler')||!transportClockUnknown()&&!engine.playing)engine.seek(beat);
},true);
// Shared FL popup (context-menu.js): legacy tuples, plus columns, ✓ states and ▸ submenus.
function menu(e,items){pianoSnapMenuCancel?.();const m=$('#context-menu');m.removeAttribute('role');m.innerHTML=renderMenuHtml(items);m.classList.toggle('multi-column',!!m.querySelector('.menu-columns'));m.classList.remove('hidden');m.style.left=`${Math.max(0,Math.min(e.clientX,innerWidth-Math.max(230,m.offsetWidth)))}px`;m.style.top=`${Math.max(0,Math.min(e.clientY,innerHeight-m.offsetHeight-24))}px`;bindMenu(m,items,{close:()=>m.classList.add('hidden'),run:item=>Promise.resolve().then(()=>item.run()).catch(fail)});}
document.addEventListener('pointerdown',e=>{if(!e.target.closest('#context-menu, #main-menu'))$('#context-menu').classList.add('hidden');});
// Logic: an open menu (menu bar, local, context, tool, slot menu) owns every key. Window capture,
// ahead of logic-keys and the editors, so no key reaches the Piano Roll / Tracks area underneath.
window.addEventListener('keydown',e=>{
 const m=$('#context-menu'),swallow=(prevent=true)=>{if(prevent)e.preventDefault();e.stopImmediatePropagation();e.stopPropagation();};
 if(m&&!m.classList.contains('hidden')){
  // The piano snap popup keeps its own radio navigation on its focused buttons.
  if(m.getAttribute('role')==='menu'&&m.contains(e.target)&&['ArrowDown','ArrowUp','Home','End','Escape','Enter',' '].includes(e.key))return;
  // T ▸ tool key picks a tool (logic-keys).
  if(m.classList.contains('logic-tool-menu')&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&!e.shiftKey&&LOGIC_TOOLS.some(item=>item.key===String(e.key).toLowerCase()))return;
  swallow();
  menuKeyDown(m,e,{close:()=>{m.classList.add('hidden');pianoSnapMenuCancel?.();},adjacent:dir=>{if(!mainMenuOpen||m.firstElementChild!==mainMenuOpen.node)return;const names=$$('#main-menu [data-menu]').map(b=>b.dataset.menu);if(!names.length)return;openMainMenu(names[(names.indexOf(mainMenuOpen.name)+dir+names.length)%names.length]);}});
  return;
 }
 const slot=document.querySelector('.logic-plugin-menu');if(!slot)return;
 if(e.key==='Escape'){swallow();slot.dispatchEvent(new Event('logic-close'));return;}
 if(e.target?.closest?.('.logic-plugin-menu-search'))return;// the search field types; its Return picks the first match
 swallow(!(slot.contains(e.target)&&['Enter',' '].includes(e.key)));
},true);
function dialog(title,content,{modeless=false,className=''}={}){const d=document.createElement('dialog');d.className='studio-dialog'+(className?' '+className:'');if(modeless)d.setAttribute('data-modeless','');d.innerHTML=`<header>${esc(title)}<button aria-label="Close">×</button></header><div class="dialog-content">${content}</div>`;document.body.append(d);d.querySelector('header button').onclick=()=>d.close();d.addEventListener('close',()=>d.remove());if(modeless){d.show();d.style.position='fixed';d.style.margin='0';const width=d.getBoundingClientRect().width||Math.min(510,innerWidth*.9);d.style.left=Math.max(6,(innerWidth-width)/2)+'px';d.style.top=Math.max(86,Math.round(innerHeight*.2))+'px';windows.raise(d);d.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.defaultPrevented){event.preventDefault();event.stopPropagation();d.close();}});}else d.showModal();return d;}
function shortcutDialogOpen(event){const historyKey=!!event&&(event.ctrlKey||event.metaKey)&&String(event.key||'').toLowerCase()==='z';return !!$('dialog[open]:not([data-modeless])')||!!(event?.target||document.activeElement)?.closest?.(historyKey?'dialog[open]:not([data-modeless])':'dialog[open]');}
function textDialog(title,label,value,callback){const d=dialog(title,`<form><label>${esc(label)}</label><input required value="${esc(value)}"><button type="submit" class="primary">Apply</button><button type="button" class="cancel">Cancel</button></form>`);d.querySelector('input').select();d.querySelector('form').onsubmit=e=>{e.preventDefault();const value=d.querySelector('input').value.trim();if(value)callback(value);d.close();};d.querySelector('.cancel').onclick=()=>d.close();}
function renamePattern(id){
 const p=project.patterns.find(p=>p.id===id);if(!p||id==='empty')return;const scope=JSON.stringify(fileImportScope()),before=p.name;
 textDialog('Rename pattern','Pattern name',before,name=>{if(scope!==JSON.stringify(fileImportScope()))return;const current=project.patterns.find(p=>p.id===id);if(!current)return;if(current.name!==before)return toast('The pattern name changed. Reopen Rename pattern.');edit(()=>current.name=name);});
}
let renameFocusedPending=false;
async function renameFocused({editor}){
 if(renameFocusedPending||!engine.ready||engine.loading||engine.applying||engine.interacting||windows.dragging||activePlaylistCancel||activePianoCancel||activeRackCancel||workspaceBusy()||rangeBusy()||sliceBusy())return;
 // Native F2 names the current pattern from Playlist, Piano roll and Rack.
 if(['playlist','piano','rack'].includes(editor))return renamePattern(pattern().id);
 if(editor!=='mixer')return;const row=currentMixerRow(),scope=JSON.stringify(fileImportScope());
 if(!row?.verified||!row.persisted)return toast('Reload the saved Mixer track before renaming it.');
 if(row.kind==='bus'&&row.id==='master')return toast('Freestyle does not support renaming the Master bus.');
 if(row.kind==='lane'){
  const index=project.cloud?.timelineLaneIds?.indexOf(row.id);if(!(index>=0))return toast('This Mixer lane has no saved Playlist identity to rename.');
  const before=project.trackNames?.[index],name=row.name;
  return textDialog('Rename mixer track','Track name',name,value=>{if(scope!==JSON.stringify(fileImportScope()))return;const current=currentMixerModel().rows.find(target=>target.key===row.key);if(!current?.verified||!current.persisted||current.name!==name||project.cloud?.timelineLaneIds?.[index]!==row.id||project.trackNames?.[index]!==before)return toast('The Mixer track changed. Reopen Rename mixer track.');edit(()=>{project.trackNames||={};project.trackNames[index]=value;});});
 }
 if(row.kind!=='bus')return;renameFocusedPending=true;
 try{await mixerState.refresh();if(scope!==JSON.stringify(fileImportScope())||shortcutDialogOpen()||currentMixerRow()?.key!==row.key)return;
  const saved=mixerState.snapshot().buses?.find(bus=>(bus.id??bus.bus_id)===row.id);if(!saved||typeof saved.name!=='string')return;
  const before=saved.name;textDialog('Rename mixer bus','Bus name',before,value=>{if(scope!==JSON.stringify(fileImportScope()))return;const actual=mixerState.snapshot().buses?.find(bus=>(bus.id??bus.bus_id)===row.id);if(!actual||actual.name!==before)return toast('The saved bus name changed. Reopen Rename mixer bus.');mixerState.updateBus({bus_id:row.id,name:value}).then(async()=>{if(scope!==JSON.stringify(fileImportScope()))return;await engine.refresh();if(scope===JSON.stringify(fileImportScope()))renderMixer();}).catch(fail);});
 }finally{renameFocusedPending=false;}
}
function patternLengthDialog(p=pattern()){return textDialog('Pattern length','Length in bars (1–64)',patternLengthBeats(p)/4,value=>{const bars=Number(value);if(Number.isInteger(bars)&&bars>=1&&bars<=64)edit(()=>setPatternLengthBars(p,bars));else toast('Enter a whole number from 1 to 64.');});}
/** Logic Pattern Browser ▸ Duplicate Pattern: a saved copy placed after the original, then selected. */
function duplicatePattern(id){const p=project.patterns.find(p=>p.id===id);if(!p||id==='empty')return;let next;try{next=clonePatternForCreate(project,p,{id:'local-'+uid()});}catch(error){toast(error.message);return;}edit(()=>{project.patterns.splice(project.patterns.indexOf(p)+1,0,next);project.selectedPattern=next.id;});}
function patternMenu(e,id){const p=project.patterns.find(p=>p.id===id);menu(e,[['New Pattern','',addPattern],['Rename Pattern…','',()=>renamePattern(id)],['Duplicate Pattern','',()=>duplicatePattern(id)],['Pattern Length…','',()=>patternLengthDialog(p)],null,['Delete Pattern','',()=>{if(project.patterns.length===1){toast('Keep at least one pattern in the project.');return;}edit(()=>{project.patterns=project.patterns.filter(x=>x!==p);project.clips=project.clips.filter(c=>c.patternId!==id);project.selectedPattern=project.patterns[0].id;});}]]);}
// FL channel-menu step operations (rack-step-ops.js). They act on every
// selected channel when the target is among them, else on that channel; one
// optimistic edit = one named Undo step of the current pattern.
function rackStepRow(id){const c=project.channels.find(c=>c.id===id);return !!c&&c.type!=='instrument';}
// Selected rows as step-row keys: a registered channel's id, or the row id of
// an unregistered sample row (FL fills every selected channel; the row's
// source is registered with its steps in the same edit).
function rackStepKey(row){if(row?.channel)return rackStepRow(row.channel.id)?row.channel.id:null;return rackMissingStepTemplate(row).source?row.id:null;}
function rackStepChannelIds(id){const rows=rackDisplayRows(),selected=[...rackSelector.ids].map(rowId=>rackStepKey(rows.find(row=>row.id===rowId))).filter(Boolean);return id==null?selected:selected.includes(id)?selected:rackStepRow(id)?[id]:[];}
function rackStepOperation(ids,label,transform){
 if(rackMembershipBusy||rackStepQueue.length||rackStepGesture.active||rackGraph?.busy){toast('Finish the current step edit first.');return false;}
 if(!ids.length){toast('Select a step sequencer channel first.');return false;}
 // Built on the rows as shown, including edits still queued behind Undo/Redo.
 const beats=patternLengthBeats(pattern()),next=new Map(),basis=new Map(),storedRow=id=>{const stored=pattern().steps?.[id];return Array.isArray(stored)?stored:Array(rackRowLength(null,beats)).fill(false);};
 for(const id of ids){const current=rackPendingSteps.get(id)||storedRow(id),steps=transform(current,beats,id);if(!sameSteps(current,steps)){next.set(id,steps);basis.set(id,current.slice());}}
 if(!next.size){toast(`${label}: the steps are unchanged.`);return false;}
 const apply=()=>{
  if([...next.keys()].some(id=>!project.channels.some(c=>c.id===id)))return commitRackSteps({stepsByChannel:next,label}).catch(error=>{fail(error);return false;});
  engine.patternHistory?.hintLabel?.(label,{kind:'pattern'});
  const applied=edit(()=>{const p=pattern();p.steps||={};for(const [id,steps]of next)p.steps[id]=steps;});
  if(!applied){engine.patternHistory?.hintLabel?.(null);return false;}
  // QA round 18: "applied" means saved. A refused save resolves false (the
  // engine has rolled the repaint back and shown the error).
  return engine.whenSaved?engine.whenSaved():applied;
 };
 if(!rackEditQueueDepth&&!rackHistorySaving())return apply();
 // FL never makes you wait: repaint now, apply right after the saving
 // Undo/Redo (and earlier queued rack edits) settle, as its own later step.
 const scope=JSON.stringify(rackMembershipScope());for(const [id,steps]of next)rackPendingSteps.set(id,steps);applyRackStepOverlay();clientLog('rack-edit-queued',{label,channels:next.size,depth:rackEditQueueDepth+1});
 const release=()=>{for(const [id,steps]of next)if(rackPendingSteps.get(id)===steps)rackPendingSteps.delete(id);};
 return queueRackEdit(()=>{
  const reason=JSON.stringify(rackMembershipScope())!==scope?'the project or pattern changed':[...basis].some(([id,steps])=>!sameSteps(storedRow(id),steps))?'its channel steps changed meanwhile':null;
  release();if(reason){renderRack();toast(`${label} was not applied: ${reason}.`);clientLog('rack-edit-queued',{label,applied:false,reason});return false;}
  return apply();
 },()=>{release();renderRack();});
}
function rackHistorySaving(){return historyQueueDepth>0||!!engine.historyPending||!!engine.patternHistory?.busy||!!engine.patternHistory?.optimisticPending;}
async function rackHistoryIdle(limitMs=30000){const started=Date.now();while(rackHistorySaving()&&Date.now()-started<limitMs)await Promise.race([historyQueue,nextHistorySettle(),new Promise(resolve=>setTimeout(resolve,25))]);await new Promise(resolve=>setTimeout(resolve,0));if(rackHistorySaving())throw new Error('Undo/Redo is still saving');}
/** Run a rack edit now, or in order after the saving Undo/Redo and earlier queued rack edits. */
function queueRackEdit(run,rollback=()=>{}){
 if(!rackEditQueueDepth&&!rackHistorySaving())return Promise.resolve().then(run);
 rackEditQueueDepth++;const next=rackEditQueue.then(()=>rackHistoryIdle()).then(run,error=>{rollback();toast(`The rack edit was not applied: ${error.message}.`);return false;}).finally(()=>{rackEditQueueDepth--;});
 rackEditQueue=next.catch(()=>{});return next;
}
function fillRackChannel(id,every){return rackStepOperation(rackStepChannelIds(id),`Fill each ${every} steps`,(row,beats)=>fillEachSteps(row,every,beats));}
function rotateRackChannels(ids,delta){return rackStepOperation(ids,delta<0?'Rotate left':'Rotate right',(row,beats)=>rotateSteps(row,delta,beats));}
// FL Advanced Fill tool (stepsequencer_advancedfilltool.htm): per-channel
// sequence (Manual / Fill every / Euclidean), a step wheel with draggable
// nodes, live preview on the rack's steps (reverted on Cancel), audition via
// the pattern preview route, dice, Reset (this channel), All (every channel)
// and Accept (every channel, one Undo step).
let advancedFillPreviewing=false;
async function advancedFillPlay(content){
 if(engine.playAttempt||engine.playing||engine.previewing){if(await stop()===false)return false;}
 const playing=engine.play(project,'pattern',{patternContent:content});advancedFillPreviewing=true;paintTransportBusy();const result=await playing;paintTransportBusy();
 if(result===false){advancedFillPreviewing=false;return false;}
 $('#play').classList.add('playing');$('#play').textContent='Ⅱ';$('#status-message').textContent='Playing the Advanced fill preview';startTransportFrames();return true;
}
function advancedFillDialog(id){
 // FL: the Channel box lists every step-sequencer channel of the rack (click /
 // scroll cycles), starting at the selected one; Accept applies each changed one.
 const selectedIds=rackStepChannelIds(id),ids=[...new Set([...rackDisplayRows().map(rackStepKey).filter(Boolean),...selectedIds])];if(!ids.length)return toast('Select a step sequencer channel first.');
 const beats=patternLengthBeats(pattern()),span=patternStepCount(beats),patternId=pattern().id;
 const nameOf=key=>project.channels.find(c=>c.id===key)?.name||rackDisplayRows().find(row=>row.id===key)?.model?.name||'Channel';
 const stored=key=>{const steps=pattern().steps?.[key];return Array.isArray(steps)?steps.slice():Array(rackRowLength(null,beats)).fill(false);};
 const initial=key=>({mode:'manual',sequenceLength:span,stepCount:4,rotate:0,manual:stored(key).slice(0,span)});
 const settings=new Map(ids.map(key=>[key,initial(key)]));let current=selectedIds[0]??(ids.includes(id)?id:ids[0]),seed=1,solo=false,accepted=false;
 const candidate=key=>advancedFillSteps(stored(key),settings.get(key),beats);
 const d=dialog('Advanced fill',`<form class="advanced-fill" novalidate><div class="af-row"><span class="af-label">Channel</span><div class="af-box" data-box="channel"></div></div><div class="af-body"><svg class="af-wheel" viewBox="0 0 160 160" role="group" aria-label="Step wheel: click a node to toggle it, drag a node to rotate"></svg><div class="af-transport"><button type="button" class="af-play" title="Play the pattern with this fill">▶</button><button type="button" class="af-stop" title="Stop">■</button><button type="button" class="af-solo" aria-pressed="false" title="Solo the edited channels in the preview">Solo</button><button type="button" class="dice" title="Randomize steps within the parameters of the current settings">⚄</button></div></div><div class="af-values"><div class="af-row"><span class="af-label">Fill type</span><div class="af-box" data-box="mode"></div></div><div class="af-row"><span class="af-label">Sequence length</span><div class="af-box" data-box="sequenceLength"></div></div><div class="af-row"><span class="af-label af-count-label">Interval</span><div class="af-box" data-box="stepCount"></div></div><div class="af-row"><span class="af-label">Rotate</span><div class="af-box" data-box="rotate"></div></div></div><p class="af-error" role="alert" hidden></p><div class="advanced-fill-actions"><button type="button" class="af-reset" title="Reset this channel to its steps before the editor">Reset</button><button type="button" class="af-all" title="Reset all channels in the editor">All</button><button type="button" class="primary af-accept">Accept</button><button type="button" class="cancel">Cancel</button></div></form>`),form=d.querySelector('form'),wheel=form.querySelector('.af-wheel'),boxElement=name=>form.querySelector(`[data-box="${name}"]`),normalRotate=(value,size)=>((Math.trunc(value)||0)%size+size)%size;
 // Live preview straight onto each edited channel's rack steps (not saved).
 const paintRack=()=>{if(pattern().id!==patternId)return;for(const key of ids){const row=$$('#rack .rack-channel').find(node=>node.dataset.channel===key)||$$('#rack .rack-channel').find(node=>node.dataset.rackRow===key),steps=candidate(key);for(const cell of row?.querySelectorAll('.step[data-step]')||[]){const on=!!steps[+cell.dataset.step];cell.classList.toggle('on',on);cell.setAttribute('aria-pressed',String(on));}}};
 const sequence=()=>{const s=settings.get(current);return advancedFillSteps([],s,s.sequenceLength/4).slice(0,s.sequenceLength);};
 // Every edit lands in `settings` (the state Accept applies), never only in the view.
 const paint=()=>{const s=settings.get(current);s.rotate=normalRotate(s.rotate,s.sequenceLength);const cells=sequence(),points=wheelPoints(cells.length,62,80),r=Math.max(3,Math.min(9,150/cells.length));
  wheel.innerHTML=`<circle class="af-ring" cx="80" cy="80" r="62"></circle>`+points.map((point,index)=>`<circle class="af-node${cells[index]?' on':''}" data-step="${index}" cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${r}"><title>Step ${index+1}</title></circle>`).join('')+`<g class="af-knob" role="slider" aria-label="Rotate" aria-valuenow="${s.rotate}"><circle cx="80" cy="80" r="24"></circle><line x1="80" y1="80" x2="${(80+20*Math.sin(s.rotate/s.sequenceLength*2*Math.PI)).toFixed(2)}" y2="${(80-20*Math.cos(s.rotate/s.sequenceLength*2*Math.PI)).toFixed(2)}"></line><text class="af-rotate" x="80" y="112" text-anchor="middle">${s.rotate}</text></g>`;
  boxes.channel.set(current);boxes.mode.set(s.mode);boxes.sequenceLength.set(s.sequenceLength);boxes.stepCount.update({max:s.sequenceLength});boxes.stepCount.set(Math.min(s.stepCount,s.sequenceLength));boxes.rotate.update({max:s.sequenceLength-1});boxes.rotate.set(s.rotate);
  const countLabel=s.mode==='euclidean'?'Step count':'Interval';form.querySelector('.af-count-label').textContent=countLabel;boxes.stepCount.update({label:countLabel});boxElement('stepCount').setAttribute('aria-disabled',String(s.mode==='manual'));paintRack();};
 const edited=fn=>value=>{fn(settings.get(current),value);paint();};
 const boxes={
  channel:valueBox(boxElement('channel'),{label:'Channel',value:current,options:ids.map(key=>({value:key,label:nameOf(key)})),wrap:true,onChange:value=>{current=value;paint();}}),
  mode:valueBox(boxElement('mode'),{label:'Fill type',value:'manual',options:[{value:'manual',label:'Manual'},{value:'every',label:'Fill every'},{value:'euclidean',label:'Euclidean'}],wrap:true,onChange:edited((s,value)=>{if(value==='manual'&&s.mode!=='manual'){s.manual=sequence();s.rotate=0;}s.mode=value;})}),
  sequenceLength:valueBox(boxElement('sequenceLength'),{label:'Sequence length',value:span,min:1,max:span,onChange:edited((s,value)=>{s.sequenceLength=value;})}),
  stepCount:valueBox(boxElement('stepCount'),{label:'Interval',value:4,min:1,max:span,onChange:edited((s,value)=>{s.stepCount=value;})}),
  rotate:valueBox(boxElement('rotate'),{label:'Rotate',value:0,min:0,max:span-1,wrap:true,onChange:edited((s,value)=>{s.rotate=value;})})};
 // Wheel: click a node toggles it (Manual); dragging a node rotates the sequence.
 let drag=null;const stepAt=event=>{const box=wheel.getBoundingClientRect();if(!box.width)return null;return wheelStepAt(event.clientX-(box.left+box.width/2),event.clientY-(box.top+box.height/2),settings.get(current).sequenceLength);};
 // FL's centre knob: drag up/down (or scroll) to rotate the sequence.
 let knob=null;wheel.addEventListener('pointerdown',event=>{if(!event.target.closest?.('.af-knob'))return;event.preventDefault();knob={y:event.clientY,base:settings.get(current).rotate};try{wheel.setPointerCapture?.(event.pointerId);}catch{}});
 wheel.addEventListener('pointermove',event=>{if(!knob)return;const s=settings.get(current),next=normalRotate(knob.base+Math.trunc((knob.y-event.clientY)/VALUE_BOX_DRAG_PX),s.sequenceLength);if(next!==s.rotate){s.rotate=next;paint();}});
 wheel.addEventListener('pointerup',()=>{knob=null;});wheel.addEventListener('wheel',event=>{if(!event.target.closest?.('.af-knob'))return;event.preventDefault();if(!event.deltaY)return;const s=settings.get(current);s.rotate=normalRotate(s.rotate+(event.deltaY<0?1:-1),s.sequenceLength);paint();},{passive:false});
 wheel.addEventListener('pointerdown',event=>{const node=event.target.closest?.('.af-node');if(!node)return;event.preventDefault();drag={step:+node.dataset.step,at:+node.dataset.step,moved:false};try{wheel.setPointerCapture?.(event.pointerId);}catch{}});
 wheel.addEventListener('pointermove',event=>{if(!drag)return;const at=stepAt(event);if(at===null||at===drag.at)return;const s=settings.get(current);s.rotate+=wheelRotation(drag.at,at,s.sequenceLength);drag.at=at;drag.moved=true;paint();});
 wheel.addEventListener('pointerup',()=>{const was=drag;drag=null;if(!was||was.moved)return;const s=settings.get(current);if(s.mode!=='manual'){s.manual=sequence();s.rotate=0;s.mode='manual';}const size=s.sequenceLength,index=(((was.step-s.rotate)%size)+size)%size,manual=Array.from({length:size},(_,i)=>s.manual?.[i]??false);manual[index]=manual[index]?false:true;s.manual=manual;paint();});
 wheel.addEventListener('pointercancel',()=>{drag=null;});
 const content=()=>{const copy=clone(project),target=copy.patterns.find(item=>item.id===patternId);for(const key of ids)if(copy.channels.some(c=>c.id===key))target.steps[key]=candidate(key);syncProjectStepPiano(copy);const score=serializeCloudPattern(target,copy).pattern;if(!solo)return score;const keep=new Set(ids.filter(key=>key===current||!sameSteps(stored(key),candidate(key))).map(key=>String(target.cloudSources?.[key]??copy.channels.find(c=>c.id===key)?.sourceId??key)));return{...score,sources:score.sources.map(source=>keep.has(String(source.id))?source:{...source,muted:true})};};
 form.querySelector('.af-play').onclick=()=>{if(pattern().id!==patternId)return toast('The pattern changed; reopen Advanced fill.');advancedFillPlay(content()).catch(fail);};
 form.querySelector('.af-stop').onclick=()=>{if(engine.playAttempt||engine.playing||engine.previewing)Promise.resolve(stop()).catch(fail);};
 form.querySelector('.af-solo').onclick=event=>{solo=!solo;event.currentTarget.setAttribute('aria-pressed',String(solo));event.currentTarget.classList.toggle('lit',solo);};
 form.querySelector('.dice').onclick=()=>{settings.set(current,{...randomizeAdvancedFill(settings.get(current),seed++),manual:settings.get(current).manual});paint();};
 form.querySelector('.af-reset').onclick=()=>{settings.set(current,initial(current));paint();};
 form.querySelector('.af-all').onclick=()=>{for(const key of ids)settings.set(key,initial(key));paint();};
 form.querySelector('.cancel').onclick=()=>d.close();
 d.addEventListener('close',()=>{if(advancedFillPreviewing&&(engine.playAttempt||engine.playing||engine.previewing))Promise.resolve(stop()).catch(fail);advancedFillPreviewing=false;if(!accepted)renderRack();});
 // Accept applies every channel's current settings. It closes only once the
 // edit is applied; a refusal stays in the dialog with its reason (never a
 // silent close with nothing saved).
 const showError=message=>{const node=form.querySelector('.af-error');node.hidden=!message;node.textContent=message||'';};let accepting=false;
 form.onsubmit=event=>{event.preventDefault();form.querySelector('.af-accept').click();};
 form.querySelector('.af-accept').onclick=async()=>{if(accepting)return;accepting=true;showError('');
  try{
   if(pattern().id!==patternId)return showError('The pattern changed; reopen Advanced fill.');
   const known=new Set([...project.channels.map(c=>c.id),...rackDisplayRows().filter(row=>!row.channel).map(row=>row.id)]),gone=ids.filter(key=>!known.has(key));
   if(gone.length)return showError(`${gone.map(nameOf).join(', ')} changed in Freestyle; reopen Advanced fill.`);
   const result=new Map(ids.map(key=>[key,candidate(key)])),changedKeys=ids.filter(key=>!sameSteps(stored(key),result.get(key)));
   clientLog('advanced-fill-accept',{channels:ids.length,changed:changedKeys.length,modes:ids.map(key=>settings.get(key).mode)});
   if(!changedKeys.length){accepted=true;d.close();return toast('Advanced fill: the steps are unchanged.');}
   if(advancedFillPreviewing&&(engine.playAttempt||engine.playing||engine.previewing))Promise.resolve(stop()).catch(fail);advancedFillPreviewing=false;
   // Applies now, or (behind a saving Undo/Redo) repaints now and lands right
   // after; either way the dialog closes at once. Only an immediate refusal stays open.
   let applied;try{applied=rackStepOperation(changedKeys,'Advanced fill',(row,_beats,key)=>result.get(key));}catch(error){applied=false;$('#toast').textContent=error?.message||String(error);}
   if(applied===false){clientLog('advanced-fill-accept',{applied:false});return showError($('#toast').textContent||'Freestyle did not accept the fill. Try again.');}
   // `applied` settles once the fill is saved (true) or refused and rolled back (false; the engine shows why).
   const queuedBehind=rackEditQueueDepth>0;accepted=true;d.close();Promise.resolve(applied).then(value=>clientLog('advanced-fill-accept',{applied:value===true,queued:queuedBehind}),fail);
  }finally{accepting=false;}
 };
 paint();
}
function cloneRackChannel(id){let plan;try{plan=planChannelClone(project,id,{pattern:pattern(),uid:()=>crypto.randomUUID()});}catch(error){toast(error.message);return;}if(edit(()=>{applyChannelClone(project,plan);selectedChannel=plan.channel.id;}))toast(`Cloned ${plan.channel.name}.`);}
// Image-Line channelrack.htm "Right-Click, Channel Operations Menu", laid out
// as FL shows it (two columns, ✓ states, ▸ submenus). Items Freestyle cannot
// save are disabled with the reason.
const CHANNEL_MENU_UNSUPPORTED={
 // 338 per-channel routes (pattern-channel-ops.js) save these; the reasons
 // below remain only for channels/connections without those routes.
 channelOps:'This channel needs Freestyle’s per-channel Channel Rack routes (a Studio API pattern channel).',
 color:'Channel colors need Freestyle’s per-channel Channel Rack routes (a Studio API pattern channel).',
 icon:'Channel icons need Freestyle’s per-channel Channel Rack routes (a Studio API pattern channel).',
 cutSelf:'Cut groups need Freestyle’s per-channel Channel Rack routes on a sample channel.',
 waveform:'Freestyle stores waveform previews for sample channels only.',
 assignPlugin:'This instrument channel already plays through its own instrument track.',
 midiChannel:'The MIDI channel applies to instrument channels with Freestyle’s per-channel Channel Rack routes.',
 replacePlugin:'Freestyle binds an instrument channel to its track’s instrument; swap it in that track’s plugin window.',
 replaceNone:'This project has no other saved sample to swap in; load one first.',
 patcher:'Patcher is not available in Freestyle.',
 assign:'Assign to new instrument track needs Freestyle’s per-channel Channel Rack routes on a sample channel.',
 autoFill:'Auto fill is unavailable here (FL greys it out for this channel); Freestyle has no auto-fill setting.',
 waveformEmpty:'This sample channel has no sample loaded in Freestyle; load one to show its waveform.',
 midiThrough:'Always on in Freestyle: a note’s own MIDI channel always reaches the instrument (PatternChannel has no switch to turn it off). Notes without one use Receive notes from ▸.',
 midiThroughSample:'Freestyle MIDI channels apply to instrument channels; a sample channel plays its sample, not MIDI.',
 receive:'Freestyle has no per-channel MIDI input assignment; MIDI input plays the selected channel.',
 receiveSample:'Receive notes from sets an instrument channel’s Freestyle MIDI channel; a sample channel has none.',
 route:'Mixer track routing (outputLaneId) applies to sample channels with Freestyle’s per-channel Channel Rack routes.',
 directwave:'DirectWave is not available in Freestyle.',
 burn:'Freestyle cannot record a plugin’s generated MIDI into a pattern.'};
/** Other saved samples of this project a sample channel can switch to (FL Replace). */
function replacementSamples(c){const seen=new Set([c.audioFileId]),out=[];for(const other of project.channels){const source=other.cloudSource||{};if(other.type!=='sample'||typeof other.audioFileId!=='string'||!other.audioFileId||seen.has(other.audioFileId))continue;seen.add(other.audioFileId);out.push({name:other.name||source.name||'Sample',audioFileId:other.audioFileId,durationSec:other.durationSec??source.durationSec??0,audioUrl:source.audioUrl,mimeType:source.mimeType});}return out;}
function replaceChannelSample(id,sample,{queued=false}={}){const c=project.channels.find(c=>c.id===id);if(!c||c.type!=='sample')return false;
 // Behind a saving Undo/Redo: show the new name now, swap right after (unless the channel changed meanwhile).
 if(!queued&&(rackEditQueueDepth||rackHistorySaving())){const before=c.audioFileId,name=$$('#rack .rack-channel').find(node=>node.dataset.channel===id)?.querySelector('.channel-name');if(name)name.textContent=sample.name;
  return queueRackEdit(()=>{const now=project.channels.find(x=>x.id===id);if(!now||now.audioFileId!==before){renderRack();toast('Replace was not applied: the channel changed meanwhile.');return false;}return replaceChannelSample(id,sample,{queued:true});},renderRack);}
 engine.patternHistory?.hintLabel?.('Replace sample',{kind:'pattern'});const applied=edit(()=>{Object.assign(c,{sampleReplaced:true,audioFileId:sample.audioFileId,durationSec:sample.durationSec,audioUrl:sample.audioUrl,mimeType:sample.mimeType,name:sample.name});});if(!applied)engine.patternHistory?.hintLabel?.(null);return applied;}
/** 338 per-channel Channel Rack routes: each change is one guarded saved write
 * and one step in the global ordered history, queued behind a saving Undo. */
let rackChannelOps=null;const rackWaveforms=new SampleWaveformCache(),rackWaveformChannels=new Set();
function channelOpsReady(c){return !!c?.patternSource&&typeof c.patternId==='string'&&!!c.patternId&&typeof c.sourceId==='string'&&!!c.sourceId&&engine.session.rawState?.studioApi===true&&patternChannelOpsSupported();}
function savedPatternSources(patternId){const row=(engine.session.rawProject?.patterns||[]).find(item=>item?.id===patternId),dto=row?.data?.pattern?row.data:row,sources=dto?.pattern?.sources;return Array.isArray(sources)?sources.map((source,index)=>({source,index})).sort((a,b)=>(a.source?.order??a.index)-(b.source?.order??b.index)).map(item=>item.source):null;}
async function readChannelRack(){const scope=fileImportScope(),result=await engine.session.call('get_project',{project_id:scope.projectId});if(JSON.stringify(scope)!==JSON.stringify(fileImportScope()))throw Object.assign(new Error('The project changed while reading the Channel Rack.'),{name:'AbortError'});const saved=projectPlaylistCloneRead(engine,result,scope);engine.session.rawProject=saved.rawProject;engine.session.rawState=saved.rawState;engine.session.project=saved.project;engine.accept(saved.project);}
/** QA round 19: a channel write's receipt carries the full saved pattern row and
 * the new revision. Adopt it (the pattern row, its joined copies on placements
 * and the revision) instead of a whole-project read, so a channel step never
 * waits for read slots behind a slow background project read. */
function adoptChannelReceipt(data){
 const s=engine.session,raw=s.rawProject,row=data?.pattern,revision=data?.timelineRevision;
 if(!raw||raw.id!==engine.projectId||typeof revision!=='string'||!revision||!row||typeof row.id!=='string'||!Array.isArray(row.pattern?.sources)||!Array.isArray(row.pattern?.events)||!Array.isArray(raw.patterns)||raw.patterns.filter(item=>item?.id===row.id).length!==1)return false;
 const nextRaw={...raw,timelineRevision:revision,patterns:raw.patterns.map(item=>item.id===row.id?structuredClone(row):item),placements:Array.isArray(raw.placements)?raw.placements.map(item=>item?.patternId===row.id&&item.pattern&&typeof item.pattern==='object'?{...item,pattern:structuredClone(row)}:item):raw.placements,...raw._studioApi?{_studioApi:{...raw._studioApi,etag:JSON.stringify(revision)}}:{}};
 const state=s.rawState||{},mirror=(value,key)=>Array.isArray(value)?nextRaw[key]:value&&Array.isArray(value[key])?{...value,[key]:nextRaw[key]}:value;
 const nextState={...state,...state.patterns?{patterns:mirror(state.patterns,'patterns')}:{},...state.patternPlacements?{patternPlacements:mirror(state.patternPlacements,'placements')}:{},...Array.isArray(state.placements)?{placements:nextRaw.placements}:{},...state.project?{project:nextRaw}:{}};
 let next;try{next=normalizeCloudProject(nextRaw,nextState,{projectId:engine.projectId,trackId:s.trackId});}catch{return false;}
 if(next.patterns.some(pattern=>pattern.id===project.selectedPattern))next.selectedPattern=project.selectedPattern;
 s.rawProject=nextRaw;s.rawState=nextState;s.project=next;engine.accept(next);return true;
}
function channelOps(){rackChannelOps||=new PatternChannelOps({getScope:fileImportScope,read:readChannelRack,adopt:adoptChannelReceipt,revision:()=>engine.session.rawProject?.timelineRevision,savedSources:savedPatternSources,history:engine.patternHistory,flush:()=>engine.flush()});rackChannelOps.history=engine.patternHistory;return rackChannelOps;}
function rackChannelEdit(c,run){
 if(!channelOpsReady(c)){toast(CHANNEL_MENU_UNSUPPORTED.channelOps);return false;}
 const scope=JSON.stringify(fileImportScope());
 return queueRackEdit(async()=>{
  if(JSON.stringify(fileImportScope())!==scope){toast('The Channel Rack edit was not applied: the project changed.');return false;}
  try{const ops=channelOps(),state=await run(ops);renderAll();clientLog('rack-channel-op',{label:ops.last?.label??null,unchanged:!!state?.unchanged});return !state?.unchanged;}
  catch(error){renderAll();fail(error);clientLog('rack-channel-op',{failed:true,code:error?.code??null,status:error?.status??null});return false;}
 },()=>renderRack());
}
function updateRackChannel(c,fields,label){return rackChannelEdit(c,ops=>ops.update(c.patternId,c.sourceId,fields,{label}));}
function channelColorDialog(c){const current=channelColor(c.cloudSource?.color);const d=dialog('Change color',`<form class="channel-color-form"><label>Channel color <input type="color" name="color" value="${esc(current||'#5f8dc4')}"></label><button type="submit" class="primary">Apply</button><button type="button" class="no-color">No color</button><button type="button" class="cancel">Cancel</button></form>`);d.querySelector('.cancel').onclick=()=>d.close();d.querySelector('.no-color').onclick=()=>{d.close();updateRackChannel(c,{color:null},'Change color');};d.querySelector('form').onsubmit=event=>{event.preventDefault();const value=channelColor(d.querySelector('input').value);d.close();if(value)updateRackChannel(c,{color:value},'Change color');};}
function channelIconOptions(selected){return`<option value="">No icon</option>${CHANNEL_ICONS.map(icon=>`<option value="${icon.id}" ${icon.id===selected?'selected':''}>${esc(icon.glyph+' '+icon.label)}</option>`).join('')}`;}
function channelIconDialog(c){const d=dialog('Change icon',`<form class="channel-icon-form"><label>Icon <select name="icon">${channelIconOptions(channelIcon(c.cloudSource?.icon))}</select></label><button type="submit" class="primary">Apply</button><button type="button" class="cancel">Cancel</button></form>`);d.querySelector('.cancel').onclick=()=>d.close();d.querySelector('form').onsubmit=event=>{event.preventDefault();const value=d.querySelector('select').value||null;d.close();updateRackChannel(c,{icon:value},'Change icon');};}
/** FL "Rename, color and icon…": one saved channel change, one Undo step. */
function channelAppearanceDialog(c){
 if(!channelOpsReady(c))return textDialog('Rename channel','Channel name',c.name,name=>edit(()=>c.name=name));
 const color=channelColor(c.cloudSource?.color),icon=channelIcon(c.cloudSource?.icon);
 const d=dialog('Rename, color and icon',`<form class="channel-appearance-form"><label>Name <input name="name" required maxlength="255" value="${esc(c.name)}"></label><label>Color <input type="color" name="color" value="${esc(color||'#5f8dc4')}"></label><label><input type="checkbox" name="colored" ${color?'checked':''}> Use color</label><label>Icon <select name="icon">${channelIconOptions(icon)}</select></label><button type="submit" class="primary">Apply</button><button type="button" class="cancel">Cancel</button></form>`),form=d.querySelector('form');
 form.querySelector('[name=color]').oninput=()=>{form.querySelector('[name=colored]').checked=true;};d.querySelector('.cancel').onclick=()=>d.close();
 form.onsubmit=event=>{event.preventDefault();const name=form.querySelector('[name=name]').value.trim(),nextColor=form.querySelector('[name=colored]').checked?channelColor(form.querySelector('[name=color]').value):null,nextIcon=form.querySelector('[name=icon]').value||null,fields={};
  if(name&&name!==c.name)fields.name=name;if(nextColor!==color)fields.color=nextColor;if(nextIcon!==icon)fields.icon=nextIcon;d.close();if(Object.keys(fields).length)updateRackChannel(c,fields,'Rename, color and icon');};
 form.querySelector('[name=name]').select?.();
}
/** Distinct saved samples and instrument tracks of this project (FL Insert ▸ above/below). */
function insertableChannels(){const seen=new Set(),out=[];for(const other of project.channels){if(other.type==='sample'&&other.audioFileId&&!seen.has('a:'+other.audioFileId)){seen.add('a:'+other.audioFileId);out.push({label:other.name||'Sample',channel:{kind:'sample',name:other.name||'Sample',audioFileId:other.audioFileId}});}else if(other.type==='instrument'&&other.laneId&&!seen.has('l:'+other.laneId)){seen.add('l:'+other.laneId);out.push({label:other.name||'Instrument',channel:{kind:'plugin',name:other.name||'Instrument',laneId:other.laneId}});}}return out;}
function insertChannelItems(c,where){const sources=savedPatternSources(c.patternId)||[],index=sources.findIndex(source=>source?.id===c.sourceId),position=index<0?undefined:index+(where==='below'?1:0),items=insertableChannels();
 if(!channelOpsReady(c)||!items.length)return[{label:'No saved sample or instrument to insert',disabled:true,title:CHANNEL_MENU_UNSUPPORTED.channelOps}];
 return items.map(item=>({label:item.label,run:()=>rackChannelEdit(c,ops=>ops.add(c.patternId,item.channel,{position,label:`Insert ${item.label}`}))}));}
function cutGroupItems(c){const group=c.cloudSource?.cutGroup;return[{label:'None',checked:!(group>0),run:()=>updateRackChannel(c,{cutGroup:null},'Cut group')},null,...Array.from({length:8},(_,index)=>({label:`Group ${index+1}`,checked:group===index+1,run:()=>updateRackChannel(c,{cutGroup:index+1},'Cut group')}))];}
function midiChannelItems(c){const current=c.cloudSource?.midiChannel??null;return Array.from({length:16},(_,index)=>({label:`MIDI channel ${index+1}`,checked:(current??1)===index+1,run:()=>updateRackChannel(c,{midiChannel:index===0&&current===null?null:index+1},'MIDI channel')}));}
function routeItems(c){const lanes=(engine.session.rawProject?.lanes||[]).filter(lane=>lane?.kind==='instrument'&&typeof lane.id==='string'),current=c.cloudSource?.outputLaneId??null;return[{label:'Pattern clip’s track',checked:!current,run:()=>updateRackChannel(c,{outputLaneId:null},'Route to mixer track')},null,...lanes.map(lane=>({label:lane.name||'Track',checked:current===lane.id,run:()=>updateRackChannel(c,{outputLaneId:lane.id},'Route to mixer track')}))];}
function channelAutomationItems(c){const laneId=c.laneId||c.cloudSource?.outputLaneId||null,why='Freestyle automates a track’s volume and pan; this channel plays through no track of its own (Assign to new instrument track first).',as=(label,tuple)=>({label,run:tuple[2],disabled:!!tuple[3],title:tuple[4]||''});return[as('Volume',automationMenuItem(laneGainAutomation(laneId,c.name),why)),as('Panning',automationMenuItem(lanePanAutomation(laneId,c.name),why))];}
function toggleRackWaveform(c){if(rackWaveformChannels.has(c.id))rackWaveformChannels.delete(c.id);else rackWaveformChannels.add(c.id);paintRackChannelDecor();}
/** FL Channel Rack swing knob: the pattern's saved `swing` (0–100%), one undoable pattern edit per gesture. */
let rackSwingKnob=null,rackSwingKey='';
function syncRackSwing(){
 const button=$('#rack-swing');if(!button)return;const current=pattern(),key=JSON.stringify([engine.projectId,engine.loadVersion||0,current?.id,current?.swing??0]);
 if(rackSwingKnob&&rackSwingKey===key&&!rackSwingKnob.destroyed){rackSwingKnob.sync();return;}
 if(rackSwingKnob?.active)return;rackSwingKnob?.destroy();rackSwingKey=key;const patternId=current?.id;
 const scope=()=>{if(pattern()?.id!==patternId)throw new Error('The selected pattern changed. Use the current swing knob.');return{project:engine.projectId,load:engine.loadVersion||0,patternId};};
 rackSwingKnob=attachChannelLevelKnob(button,{getValue:()=>Math.max(0,Math.min(1,Number(pattern()?.swing)||0)),getScope:scope,isEditable:()=>!!pattern()?.cloudId&&(rackSwingKnob?.active||rackBaseEditable()&&!engine.interacting),label:'Swing',min:0,max:1,step:.01,reset:0,
  onStatus:message=>{$('#hint').textContent=message;},onInteraction:active=>{engine.interacting=active;},
  onCommit:async packet=>{if(JSON.stringify(packet.scope)!==JSON.stringify(scope()))throw new Error('The selected pattern changed before this swing gesture finished.');engine.patternHistory?.hintLabel?.('Swing',{kind:'pattern'});if(!rackEdit(()=>{pattern().swing=packet.value;})){engine.patternHistory?.hintLabel?.(null);throw new Error('Finish the current edit before changing swing.');}await engine.flush();}});
 rackSwingKnob.sync();
}
/** Channel color/icon/cut group, outputLaneId mixer routing and the sample waveform preview on the rack rows. */
function paintRackChannelDecor(){
 try{syncRackSwing();}catch{}
 const mixerRows=currentMixerModel().rows;
 for(const row of $$('#rack .rack-channel')){
  const c=project.channels.find(item=>item.id===row.dataset.channel);if(!c)continue;const source=c.cloudSource||{},name=row.querySelector('.channel-name'),color=channelColor(source.color),icon=channelIcon(source.icon);
  if(name){if(color){name.style.setProperty('--channel-color',color);name.dataset.channelColor=color;}else{name.style.removeProperty('--channel-color');delete name.dataset.channelColor;}
   if(icon){name.dataset.channelIcon=icon;name.dataset.iconGlyph=channelIconGlyph(icon);}else{delete name.dataset.channelIcon;delete name.dataset.iconGlyph;}
   if(Number.isInteger(source.cutGroup)&&source.cutGroup>0)name.dataset.cutGroup=String(source.cutGroup);else delete name.dataset.cutGroup;}
  const lane=!c.laneId&&typeof source.outputLaneId==='string'&&source.outputLaneId?source.outputLaneId:null,button=row.querySelector('.channel-number'),target=lane?mixerRows.find(item=>item.kind==='lane'&&item.id===lane):null;
  if(target&&button){button.textContent=String(mixerRows.findIndex(item=>item.key===target.key)+1);button.disabled=false;button.title=`Open ${target.name}`;button.onclick=()=>{selectedMixerKey=target.key;mixerChannel=target.id;showWindow('mixer');renderMixer();};}
  row.querySelector('.rack-waveform')?.remove();
  if(rackWaveformChannels.has(c.id)&&c.type==='sample'&&c.audioFileId){
   const known=rackWaveforms.peek(engine.projectId,c.audioFileId),host=row.querySelector('.steps');
   if(!known){rackWaveforms.get(engine.projectId,c.audioFileId).then(()=>paintRackChannelDecor(),()=>{});continue;}
   if(known.unavailable||!host){if(name)name.title=`${c.name} · Freestyle could not decode a waveform preview for this sample`;continue;}
   const holder=document.createElement('div');holder.className='rack-waveform';holder.innerHTML=sampleWaveformSvg(known,{width:160,height:20});host.append(holder);/* last child: the steps' nth-child bar colors are unchanged */
  }
 }
}
function deleteChannelConfirm(c){if(project.channels.length===1)return toast('A project keeps at least one channel.');const d=dialog('Delete channel',`<form><p>Delete channel “${esc(c.name)}”?</p><button type="submit" class="primary">Yes</button><button type="button" class="cancel">No</button></form>`);d.querySelector('.cancel').onclick=()=>d.close();d.querySelector('form').onsubmit=event=>{event.preventDefault();d.close();
  // 338: one deletePatternChannel; Undo re-adds the same channel, position and steps.
  if(channelOpsReady(c)){rackChannelEdit(c,ops=>ops.remove(c.patternId,c.sourceId,{label:`Delete ${c.name}`}));return;}
  edit(()=>{project.channels=project.channels.filter(x=>x!==c);removeChannelScore(project,c.id);});};d.querySelector('.primary').focus?.();}
function channelMenu(e,id){const c=project.channels.find(c=>c.id===id);if(!c)return;
 // FL selects the channel you right-click unless it is already in the selection.
 const rowId=rackDisplayRows().find(row=>row.channel?.id===id)?.id;if(rowId&&!rackSelector.ids.has(rowId))rackSelector.focus(rowId);
 const steps=rackStepRow(id),off=(label,reason,extra={})=>({label,disabled:true,title:CHANNEL_MENU_UNSUPPORTED[reason],...extra}),stepItem=(label,run,shortcut='')=>({label,shortcut,run,disabled:!steps,title:steps?'':'Step operations need a sample (step sequencer) channel; edit this instrument in the Piano roll.'});
 const samples=c.type==='sample'?replacementSamples(c):[],replace=c.type!=='sample'?off('Replace','replacePlugin',{submenu:[]}):samples.length?{label:'Replace',submenu:samples.map(sample=>({label:sample.name,run:()=>replaceChannelSample(id,sample)}))}:off('Replace','replaceNone',{submenu:[]});
 // 338 per-channel routes: color, icon, cut group, MIDI channel, mixer routing,
 // positional insert, delete and Assign to new instrument track (pattern-channel-ops.js).
 const ops=channelOpsReady(c),sample=c.type==='sample',sources=ops?savedPatternSources(c.patternId)||[]:[],group=c.cloudSource?.cutGroup,cutsItself=Number.isInteger(group)&&group>0,sharedCut=cutsItself&&sources.some(source=>source?.id!==c.sourceId&&source?.cutGroup===group);
 // FL greys Clone when there is nothing to clone (a sample channel with no sample, or a channel Freestyle cannot copy).
 let cloneOff=sample&&!c.audioFileId?'This sample channel has no sample loaded in Freestyle; load one before cloning it.':null;if(!cloneOff){let n=0;try{planChannelClone(project,id,{pattern:pattern(),uid:()=>`menu-probe-${n++}`});}catch(error){cloneOff=`Freestyle cannot clone this channel: ${error.message}`;}}
 const insert={label:'Insert',title:ops?'Insert above or below this channel, or add a new channel at the end of the rack.':'Freestyle adds the new channel at the end of the rack.',submenu:[...ops?[{label:'Above',submenu:insertChannelItems(c,'above')},{label:'Below',submenu:insertChannelItems(c,'below')},null]:[],...addMenuEntries({rack:true})]};
 menu(e,[{label:'Open in Piano Roll',shortcut:'',checked:channel().id===id,/* FL: ✓ = this channel is the Piano roll's target (window open or not) */run:()=>{selectedChannel=id;showWindow('piano');}},{label:'Edit Step Velocity',checked:!!rackGraph?.visible&&channel().id===id,run:()=>{selectedChannel=id;toggleRackGraph();}},null,
  {label:'Rename, color and icon…',run:()=>channelAppearanceDialog(c),title:ops?'':'Freestyle saves the channel name; color and icon are not saved.'},ops?{label:'Change color…',run:()=>channelColorDialog(c)}:off('Change color…','color'),ops?{label:'Random color',run:()=>updateRackChannel(c,{color:randomChannelColor(c.cloudSource?.color)},'Random color')}:off('Random color','color'),ops?{label:'Change icon…',run:()=>channelIconDialog(c)}:off('Change icon…','icon'),null,
  {label:'Load sample…',run:()=>{importedTarget=id;$('#import-audio').click();}},ops&&sample?{label:'Cut itself',checked:cutsItself,title:sharedCut?`Cut group ${group} (shared): a new note stops this channel’s own and the group’s sounding notes. Click to clear the group.`:cutsItself?`A new note stops this channel’s sounding note (cut group ${group}). Click to turn it off.`:'',run:()=>updateRackChannel(c,{cutGroup:cutsItself?null:freeCutGroup(sources,c.sourceId)},'Cut itself')}:off('Cut itself','cutSelf'),ops&&sample?{label:'Cut group',submenu:cutGroupItems(c)}:off('Cut group','cutSelf',{submenu:[]}),sample&&c.audioFileId?{label:'Show waveform preview',checked:rackWaveformChannels.has(id),run:()=>toggleRackWaveform(c)}:off('Show waveform preview',sample?'waveformEmpty':'waveform'),null,
  insert,replace,off('Patcherize','patcher'),{label:'Clone',run:()=>cloneRackChannel(id),disabled:!!cloneOff,title:cloneOff||''},{label:'Delete…',run:()=>deleteChannelConfirm(c),disabled:project.channels.length===1},null,ops&&sample?{label:'Assign to new instrument track',run:()=>rackChannelEdit(c,ops=>ops.assignToNewTrack(c.patternId,c.sourceId,{name:c.name}))}:off('Assign to new instrument track',ops?'assignPlugin':'assign'),ops&&sample?{label:'Route to mixer track',submenu:routeItems(c)}:off('Route to mixer track','route',{submenu:[]}),{label:'Create automation clip',submenu:channelAutomationItems(c)},
  MENU_COLUMN,
  {label:'Cut',run:()=>rackClipboardAction('cut')},{label:'Copy',run:()=>rackClipboardAction('copy')},{label:'Paste',run:()=>rackClipboardAction('paste'),disabled:!rackClipboard},null,
  stepItem('Fill each 2 steps',()=>fillRackChannel(id,2)),stepItem('Fill each 4 steps',()=>fillRackChannel(id,4)),stepItem('Fill each 8 steps',()=>fillRackChannel(id,8)),stepItem('Advanced fill…',()=>advancedFillDialog(id)),off('Auto fill','autoFill'),null,
  stepItem('Rotate left',()=>rotateRackChannels(rackStepChannelIds(id),-1),'Shift+Cmd+Left'),stepItem('Rotate right',()=>rotateRackChannels(rackStepChannelIds(id),1),'Shift+Cmd+Right'),null,
  // 338 PatternChannel.midiChannel is the one saved MIDI field: "Receive notes
  // from ▸" picks it (the instrument receives this channel's notes on that MIDI
  // channel). Freestyle always passes a note's own MIDI channel through (✓,
  // not switchable); Burn MIDI has no backend.
  off('MIDI channel through',sample?'midiThroughSample':'midiThrough',{checked:!sample}),ops&&!sample?{label:'Receive notes from',title:'The MIDI channel this instrument receives the channel’s notes on (notes without their own channel). Saved as the channel’s midiChannel.',submenu:midiChannelItems(c)}:off('Receive notes from',sample?'receiveSample':'midiChannel',{submenu:[]}),null,off('Create DirectWave instrument…','directwave'),off('Burn MIDI to','burn',{submenu:[off('Current pattern','burn'),off('New pattern','burn')]})]);}
function instrumentDialog(id){const c=project.channels.find(c=>c.id===id);if(c.plugins?.length){const plugin=channelPlugin(c);if(plugin)pluginDialog(c,plugin,{nativeFirst:true}).catch(fail);else openSelectedMixerTools(c).catch(fail);return;}const d=dialog(c.name,`<p>Cloud channel · ${esc(c.type)}<br>Instrument and sample settings run in Freestyle.</p>${c.type==='sample'&&c.audioFileId?'<div class="channel-settings-waveform" aria-label="Sample waveform"></div>':''}<button id="inst-piano">Piano roll</button><button id="inst-cloud">Cloud instruments & patches</button><button id="inst-sample">Upload audio…</button>`);
 // FL sample channel settings show the sample's waveform (338 getPatternSampleWaveform; stored peaks only).
 const wave=d.querySelector('.channel-settings-waveform');if(wave)rackWaveforms.get(engine.projectId,c.audioFileId).then(peaks=>{if(!wave.isConnected)return;if(peaks?.unavailable){wave.textContent='Freestyle could not decode a waveform preview for this sample.';wave.classList.add('unavailable');}else wave.innerHTML=sampleWaveformSvg(peaks,{width:240,height:48});},()=>{wave.textContent='The waveform preview could not be read.';wave.classList.add('unavailable');});d.querySelector('#inst-piano').onclick=()=>{selectedChannel=id;d.close();showWindow('piano');};d.querySelector('#inst-cloud').onclick=()=>{d.close();openCloudPanel().catch(fail);};d.querySelector('#inst-sample').onclick=()=>{importedTarget=id;$('#import-audio').click();d.close();};}
let modeSwitchPending=false,transportUiVersion=0,stopRequest=null,songPlayingStatus=null,playClockRead=null;
const playButtonTitle=$('#play').title;
const playbackUiScope=()=>JSON.stringify([engine.projectId,engine.session.projectId,engine.session.trackId,engine.loadVersion||0,engine.session.contextVersion||0]);
// Own only the exact Song status written after an acknowledged local Play.
// A real clock can end playback without an explicit toolbar Stop request.
function rememberSongPlayingStatus(message,scope,version){if(scope===playbackUiScope()&&version===transportUiVersion)songPlayingStatus={message,scope,version,playing:true};}
function updateSongPlayingFeedback(tick){
 const owner=songPlayingStatus;if(!owner||owner.scope!==playbackUiScope()||owner.version!==transportUiVersion||mode!=='song'||tick.previewing||engine.previewing)return;
 if(tick.transportKnown!==true||tick.clockAvailable===false||!['http','live','interactive'].includes(tick.clockSource)||typeof tick.playing!=='boolean')return;
 if(tick.playing){owner.playing=true;return;}if(!owner.playing)return;
 if(!engine.ready||engine.loading||engine.playAttempt||modeSwitchPending||stopRequest||engine.applying||engine.pending||engine.inFlight||engine.interacting||workspaceBusy()||rangeBusy()||sliceBusy()||cloudLibrary?.writeBusy||engine.recordingContext||engine.recorder.recording||['connecting','stopping'].includes(engine.recorder.state))return;
 owner.playing=false;if($('#status-message').textContent===owner.message)$('#status-message').textContent='Stopped';
}
function transportClockUnknown(clock=engine.session.positionAt?.()||{}){return clock.transportKnown===false||clock.clockSource==='none';}
function loopStateKnown(clock=engine.session.positionAt?.()||{}){return !transportClockUnknown(clock)&&(typeof engine.session.rawState?.transport?.loop_enabled==='boolean'||clock.transportKnown===undefined&&clock.clockSource===undefined&&typeof clock.loopEnabled==='boolean');}
const unknownPlaybackTitle='Playback state unknown · read Freestyle before starting or pausing';
function currentPlayClockRead(){if(playClockRead&&(playClockRead.scope!==playbackUiScope()||playClockRead.version!==transportUiVersion||engine.loading))playClockRead=null;return playClockRead;}
function playClockReadFeedback(message){const reading=currentPlayClockRead();return reading?reading.error||reading.message:message;}
var liveReadOnly=null;
/** The read-only reason while the monitor peer has no write grant, else null. */
function readOnlyRefusal(){return liveReadOnly?.reason||null;}
function paintTransportBusy(){paintTransportBusyBase();liveReadOnly?.repaint();}
function paintTransportBusyBase(){const reading=currentPlayClockRead(),busy=modeSwitchPending||!!stopRequest,starting=!!(reading||engine.playAttempt)&&!busy,button=$('#play');button.disabled=busy;button.classList.toggle('starting',starting);if(starting)button.classList.remove('playing');button.setAttribute('aria-busy',String(busy||starting));button.title=reading&&!busy?'Reading playback state · click Play again to cancel':starting?'Starting playback · click to cancel':busy?'Updating playback…':!engine.previewing&&transportClockUnknown()?unknownPlaybackTitle:playButtonTitle;button.setAttribute('aria-label',button.title);$('#mode').disabled=modeSwitchPending;$('#mode').setAttribute('aria-busy',String(modeSwitchPending));paintRecordingButton();}
function selectPlaybackMode(next){++transportUiVersion;mode=next;if(next==='pattern')engine.armPatternPreview?.('pat-mode-entry');$('#mode').classList.toggle('song',mode==='song');toast(mode==='song'?'Song mode · Playlist arrangement':'Pattern mode · selected pattern');}
async function switchPlaybackMode(){
 if(modeSwitchPending)return false;if(engine.loading){toast('Wait for the project to finish loading.');return false;}
 const next=mode==='pattern'?'song':'pattern',scope=playbackUiScope(),version=transportUiVersion,recorder=engine.recorder,active=engine.playing||engine.session.playing||engine.previewing||engine.playAttempt||engine.recordingContext||recorder.recording||['connecting','stopping'].includes(recorder.state),readUnknown=!active&&engine.ready&&transportClockUnknown();
 // Selecting an idle mode is local UI state. It must precede an immediate Play.
 if(!active&&!stopRequest&&!readUnknown){selectPlaybackMode(next);return true;}
 modeSwitchPending=true;paintTransportBusy();toast(readUnknown?'Reading playback state in Freestyle…':'Stopping playback before '+(next==='pattern'?'Pattern':'Song')+' mode…');
 try{if(readUnknown){const clock=await engine.ensureTransportKnown();if(scope!==playbackUiScope()||version!==transportUiVersion||engine.loading)return false;if(!clock.playing&&!stopRequest){selectPlaybackMode(next);return true;}}if(await stop()===false)return false;if(scope!==playbackUiScope()||engine.loading){toast('The project changed. Select the playback mode again.');return false;}selectPlaybackMode(next);return true;}
 catch(error){fail(error);return false;}
 finally{modeSwitchPending=false;paintTransportBusy();}
}
async function togglePlay({stopInsteadOfPause=false,startBeat=null}={}){
 if(readOnlyRefusal()&&!engine.playing&&!engine.playAttempt){toast(readOnlyRefusal());return false;}
 if(modeSwitchPending||stopRequest){toast('Wait for playback to stop before pressing Play.');return false;}
 if(currentPlayClockRead()){const cancelled=playClockRead;playClockRead=null;++transportUiVersion;if(cancelled.scope===playbackUiScope()&&$('#status-message').textContent===cancelled.message)$('#status-message').textContent='Playback request cancelled.';if($('#hint').textContent===cancelled.message)$('#hint').textContent='Playback request cancelled.';paintTransportBusy();return false;}
 if(engine.playAttempt)return stop();
 const version=++transportUiVersion,scope=playbackUiScope(),selectedMode=mode,current=()=>version===transportUiVersion&&scope===playbackUiScope()&&!engine.loading&&!modeSwitchPending&&!stopRequest;
 let reading=null;try{let playing=engine.playing;if(!engine.previewing&&transportClockUnknown()){reading={scope,version,message:'Reading playback state in Freestyle…',error:null};playClockRead=reading;$('#status-message').textContent=reading.message;$('#hint').textContent=reading.message;paintTransportBusy();let clock;try{clock=await engine.ensureTransportKnown();}catch(error){if(playClockRead!==reading||!current())return false;if($('#hint').textContent===reading.message)$('#hint').textContent=error.message||String(error);throw error;}if(playClockRead===reading)playClockRead=null;paintTransportBusy();if(!current())return false;playing=clock.playing;}if(playing){if(stopInsteadOfPause)return stop();await engine.pause();if(!current())return false;setPlaylistCursor(engine.positionAt().beat);$('#play').classList.remove('playing');$('#play').textContent='▶';$('#status-message').textContent='Paused';}
 else{const playing=engine.play(project,selectedMode,selectedMode==='song'?{startSeconds:(Number.isFinite(startBeat)&&startBeat>=0?startBeat:editCursorBeat)*60/project.bpm}:undefined);paintTransportBusy();if(engine.playAttempt)$('#status-message').textContent='Starting playback · click Play again to cancel';const result=await playing;if(result===false||!current())return false;$('#play').classList.add('playing');$('#play').textContent='Ⅱ';$('#status-message').textContent=`Playing ${selectedMode==='pattern'?pattern().name:'arrangement'} · ${project.bpm} BPM`;if(selectedMode==='song')rememberSongPlayingStatus($('#status-message').textContent,scope,version);startTransportFrames();}return true;}finally{if(playClockRead===reading)playClockRead=null;if(reading&&scope===playbackUiScope()&&$('#hint').textContent===reading.message)$('#hint').textContent=$('#status-message').textContent;paintTransportBusy();}
}
/** Live: Stop ends a MIDI take too (its notes commit as one edit; the track stays armed and usable). */
async function finishRecordingForStop(){
 if(ablMidiTake.active){ablMidiTake.stop();paintRecordingButton();}
 const context=engine.recordingContext;if(context?.stopPromise){try{await context.stopPromise;}finally{paintRecordingButton();}return;}
 if(context?.state==='starting'||engine.recorder.state==='connecting'){try{await engine.cancelRecording();}finally{paintRecordingButton();}return;}
 if(context||engine.recorder.recording){const capture=toggleRecord({transportStop:true}),saving=context?.stopPromise;await capture;if(saving)await saving;if(engine.recorder.recording||engine.recordingContext)throw new Error('Finish saving the microphone take before changing playback mode.');}
}
/* QA r13: Live counts in on the position display (-1.1.1 … -1.4.1 for a 1-bar count-in). The engine's startRecording
 * reply only returns at the boundary, so the beats run locally from the request at the take's tempo. */
var countInDisplay=null;/* var: updateTick may run before this line during module start-up */
function countInText(beats,elapsedBeats,perBar){const i=Math.max(0,Math.min(beats-1,Math.floor(elapsedBeats))),remaining=beats-i;return `-${Math.ceil(remaining/perBar)}.${i%perBar+1}.1`;}
function paintCountInDisplay(){const state=countInDisplay;if(!state)return;const elapsed=(performance.now()-state.since)*state.bpm/60000,text=countInText(state.beats,elapsed,state.perBar),value=$('#time-value');if(value&&value.textContent!==text)value.textContent=text;state.timer=setTimeout(paintCountInDisplay,40);}
function startCountInDisplay({countInBeats,bpm,since}={}){stopCountInDisplay(false);const beats=Number(countInBeats),tempo=Number(bpm)||Number(project?.bpm)||120;if(!(beats>0))return;countInDisplay={beats,bpm:tempo,since:Number.isFinite(Number(since))?Number(since):performance.now(),perBar:Number(project?.beatsPerBar)||4,timer:null};$('#time-display')?.classList.add('counting-in');if($('#time-display'))$('#time-display').title=`Count-In · ${beats} beat${beats===1?'':'s'}`;paintCountInDisplay();}
function stopCountInDisplay(repaint=true){const state=countInDisplay;if(!state)return;clearTimeout(state.timer);countInDisplay=null;$('#time-display')?.classList.remove('counting-in');lastTimeText='';lastTickKey='';if(repaint)try{updateTick(engine.positionAt?.()||{beat:engine.beat,playing:engine.playing,mode});}catch{}}
engine.recorder.addEventListener?.('state',event=>{const detail=event.detail||{};if(detail.state==='counting-in')startCountInDisplay(detail);else if(countInDisplay)stopCountInDisplay();if(['connecting','counting-in','arming','recording','idle','error'].includes(detail.state))try{paintRecordingButton();}catch{}});
engine.recorder.addEventListener?.('timing',event=>clientLog('abl-take-timing',event.detail||{}));
/* Freestyle #4: a take answered "placed" is on its lane at once; its save is confirmed in the background. A final
   refusal removes the clip on Freestyle's side, so the project is re-read and the user told. */
engine.recorder.addEventListener?.('saved',event=>{const detail=event.detail||{};if(engine.lastTake?.takeId===detail.takeId)engine.lastTake={...engine.lastTake,persisted:true,saving:false};clientLog('abl-take-saved',{takeId:detail.takeId,clipId:detail.clipId,confirmMs:detail.confirmMs});});
engine.recorder.addEventListener?.('save-failed',event=>{const detail=event.detail||{};clientLog('abl-take-save-failed',{takeId:detail.takeId,code:detail.code,status:detail.status,requestId:detail.requestId});if(detail.final){engine.refresh().then(()=>renderAll()).catch(()=>{});fail(new Error(detail.code==='recording_take_rejected'?'Freestyle refused the take after placing it, so it was removed. Record again.':'Freestyle could not save the take. Record again.'));}else toast('Freestyle has not confirmed the take’s save yet; it stays on the track.');});
/* Owner bug 4: Live shows the take as a clip that appears at the record position and grows with a live waveform. The clip is an
   overlay that follows the engine position; its waveform is the recording lane's engine meter (no browser audio analysis). */
const ablLiveTakeClip=new LiveRecordingClip({laneGrid:track=>document.querySelector(`#track-lanes .lane-grid[data-track="${track}"]`),pxPerBeat:()=>barWidth/4,bpm:()=>project.bpm,positionSec:()=>engine.session.positionAt?.()?.seconds??null,waveforms:ablWaveforms,
 level:()=>{try{const laneId=ablLiveTakeClip.laneId,model=currentMixerModel(),row=model.rows.find(row=>row.laneId===laneId||row.id===laneId);if(!row)return null;const reading=mixerMeterReading(row,model);return reading.known?reading.value:null;}catch{return null;}}});
{let pendingStart=null,settle=null;
 engine.recorder.addEventListener?.('timing',event=>{const detail=event.detail||{};if(detail.phase==='start')pendingStart={takeId:detail.takeId,songStartSec:Number(detail.songStartSec)||0};});
 engine.recorder.addEventListener?.('state',event=>{const detail=event.detail||{};
  if(detail.state==='recording'&&!ablLiveTakeClip.active){clearInterval(settle);const laneId=detail.laneId||null,track=(project.cloud?.timelineLaneIds||[]).indexOf(laneId);if(track<0)return;ablLiveTakeClip.laneId=laneId;ablLiveTakeClip.start({takeId:detail.takeId,track,startSec:pendingStart&&pendingStart.takeId===detail.takeId?pendingStart.songStartSec:engine.session.positionAt?.()?.seconds||0,name:project.trackNames?.[track]||'Audio'});clientLog('abl-live-take-clip',{stage:'shown',track});}
  else if(detail.state==='stopping')ablLiveTakeClip.freeze();
  else if(detail.state==='stopped'){ablLiveTakeClip.freeze();const clipId=detail.clipId?String(detail.clipId):null,deadline=performance.now()+8000;clearInterval(settle);settle=setInterval(()=>{if(clipId&&findClip(clipId)||performance.now()>deadline){clearInterval(settle);ablLiveTakeClip.remove();}},50);}
  else if(detail.state==='idle'||detail.state==='error'){clearInterval(settle);ablLiveTakeClip.remove();}});}
window.ablLiveTakeClip=ablLiveTakeClip;
/** Studio Pro-style preconnect: an armed audio track keeps a warm live-ingest uplink, so ● only opens the mic and arms. */
function syncLiveIngestPrewarm(){
 const recorder=engine.recorder;if(!recorder?.prewarm||recorder.attempt)return;
 const tools=window.vegetableStudio?.regionTools,laneId=tools?.recordState?.armed||null,kind=tools?.recordState?.armedKind,audio=laneId&&!MIDI_RECORD_LANE_KINDS.has(kind)&&(!kind||RECORD_LANE_KINDS.has(kind));
 if(!audio||!engine.ready||readOnlyRefusal?.()){if(recorder.warm)recorder.dropPrewarm();return;}
 const client=ablStudioClient?.();if(!client)return;
 recorder.prewarm(engine.projectId,laneId,studioRecordingHooks({client,projectId:engine.projectId}));
}
for(const type of ['click','keyup'])document.addEventListener(type,()=>setTimeout(()=>{try{syncLiveIngestPrewarm();}catch{}},0),true);
/* Round 2: the uplink is closed with each take. Re-open it as soon as the take has settled so the next ● on the still-armed track starts warm (measured live: 0.8 s warm vs 2.0–3.0 s cold). */
engine.recorder.addEventListener?.('state',event=>{if(['stopped','idle','error'].includes(event.detail?.state))setTimeout(()=>{try{syncLiveIngestPrewarm();}catch{}},300);});
/** ■ during our own live-ingest take (or its count-in): end the take/arm first, then pause the shared transport.
 * Both calls start on this frame (stopping state, local silence + frozen playhead); only the native pause waits. */
async function stopOwnTakeThenPause(armEnded){
 // Receive audio goes silent on the press frame, before take_stop / finalize leave (they are now sent at once, #4).
 try{engine.monitor.silence?.();}catch{}
 const finishing=finishRecordingForStop(),finished=finishing.then(()=>{},()=>{});
 const after=armEnded?Promise.race([armEnded,finished]):finished;
 let refusal=await engine.stop({endRecording:false,after}).then(()=>null,error=>error);
 if(refusal?.code==='recording_active'){
  // The arm outlived the first finalize reply: pause again once the take is fully stopped and saved (or failed).
  clientLog('abl-stop-pause-retry',{code:refusal.code});await finished;refusal=await engine.stop({endRecording:false}).then(()=>null,error=>error);
 }
 await finishing;if(refusal)throw refusal;
}
function stop(){
 pianoScrubCancel?.();playClockRead=null;++transportUiVersion;if(stopRequest)return stopRequest;const scope=playbackUiScope();$('#status-message').textContent=engine.previewing||engine.playAttempt?.previewPending?'Stopping pattern preview in Freestyle…':'Stopping playback in Freestyle…';
 // Our own Studio API live-ingest take (or its count-in arm) ends with take_stop + finalizeRecording; Freestyle refuses
 // end_recording on the pause while that API arm records (recording_shared, live QA r12), so this Stop pauses without it.
 const ownTake=engine.recorder.mode==='live-ingest'&&(engine.recorder.recording||['connecting','counting-in','arming'].includes(engine.recorder.state));
 // QA r13: it also refuses the pause itself while that arm records (ack recording_active, "Stop recording before pausing
 // the shared transport"), so the pause goes out once take_stop + the first finalizeRecording reply have ended the arm
 // (Pro's group recording: leader disarm, then /transport/pause). Audio and playhead still stop locally on this frame.
 const armEnded=ownTake?engine.recorder.armEnded?.()??null:null;
 const request=(async()=>{try{if(ownTake)await stopOwnTakeThenPause(armEnded);else await Promise.all([engine.stop(),finishRecordingForStop()]);if(scope!==playbackUiScope()||engine.loading)return false;$('#play').classList.remove('playing');$('#play').textContent='▶';if(playheadFrame!==null)cancelAnimationFrame(playheadFrame);playheadFrame=null;updateTick(engine.positionAt?.()||{beat:engine.beat,playing:false,mode});$('#status-message').textContent='Stopped';return true;}catch(error){if(scope===playbackUiScope()&&!engine.loading)fail(error);return false;}})();
 // Studio Pro: Stop takes effect locally on this frame (engine.stop has already
 // faded the receive audio and frozen the clock); the engine ACK only confirms it.
 if(playheadFrame!==null)cancelAnimationFrame(playheadFrame);playheadFrame=null;try{if(engine.localStopHold)updateTick(engine.positionAt());}catch{}
 const pending=request.finally(()=>{if(stopRequest===pending){stopRequest=null;paintTransportBusy();}});stopRequest=pending;paintTransportBusy();return pending;
}
let playheadFrame=null,lastTimeText='';
function updateTick(t){
 renderMetronome();updateSongPlayingFeedback(t);
 const dragging=windows.dragging,unknown=transportClockUnknown(t);
 const button=$('#play');if(engine.playAttempt||button.classList.contains('starting'))paintTransportBusy();if(button.classList.contains('playing')!==!!t.playing){button.classList.toggle('playing',!!t.playing);button.textContent=t.playing?'Ⅱ':'▶';}
 button.dataset.transportState=unknown?'unknown':t.playing?'playing':'stopped';if(!engine.playAttempt&&!currentPlayClockRead()&&!modeSwitchPending&&!stopRequest){button.title=unknown?unknownPlaybackTitle:playButtonTitle;button.setAttribute('aria-label',button.title);}
 // Preview playback acknowledgement and its display clock are separate:
 // an unavailable audio-device position must not retain an old song counter.
 const previewPositionUnknown=!!t.previewing&&(t.clockAvailable===false||t.previewClockAvailable===false||t.beat==null||!Number.isFinite(Number(t.beat))),positionUnknown=unknown||previewPositionUnknown;
 const available=!positionUnknown&&t.clockAvailable!==false&&t.beat!=null&&Number.isFinite(Number(t.beat));
 const beat=available?Number(t.beat):0,rolling=!!t.playing&&available;
 const timelineClock=t.previewing?(engine.session.positionAt?.()||{}):t,loopKnown=loopStateKnown(timelineClock),loopKey=`${loopKnown}:${timelineClock.loopEnabled}:${timelineClock.loopStartSec}:${timelineClock.loopEndSec}:${timelineClock.bpm}`;if(loopKey!==lastLoopKey&&!engine.interacting&&!dragging){lastLoopKey=loopKey;renderPlaylist();}
 const phase=patternPlaybackAt(project,pattern().id,positionUnknown?{...t,clockAvailable:false}:t,{mode,previewPatternId:engine.previewPatternId,selectedClipId:selectedClip});
 const key=`${unknown}:${previewPositionUnknown}:${available}:${beat}:${rolling}:${phase.beat}:${mode}:${barWidth}:${pianoBarWidth}:${editCursorBeat}`;if(key===lastTickKey)return;lastTickKey=key;
 $('#time-display').title=previewPositionUnknown?'Pattern preview position unavailable · Freestyle has not supplied a usable preview clock. The Playlist edit cursor remains available.':unknown?'Transport position unknown · waiting for Freestyle. The Playlist edit cursor remains available.':'Playback position · bars, steps and ticks';
 if((positionUnknown||available||!t.playing)&&!dragging&&!countInDisplay){const displayBeat=t.playing?beat:editCursorBeat,text=positionUnknown?'--:--:--':formatTransportPosition(displayBeat);if(text!==lastTimeText){$('#time-value').textContent=text;lastTimeText=text;}}
 const step=phase.active?phase.step:-1;if(step!==lastTickStep&&!dragging){lastTickStep=step;$$('.step.current').forEach(b=>b.classList.remove('current'));if(step>=0)$$(`.step[data-step="${step}"]`).forEach(b=>b.classList.add('current'));}
 $('#edit-playhead').classList.toggle('is-ghost',rolling&&mode==='song');$('#edit-playhead').style.display='block';$('#edit-playhead').dataset.timelineX=String(editCursorBeat/4*barWidth);$('#edit-playhead').style.transform=`translate3d(${editCursorBeat/4*barWidth}px,0,0)`;
 $('#song-playhead').style.display=rolling&&mode==='song'?'block':'none';$('#song-playhead').dataset.timelineX=String(beat/4*barWidth);$('#song-playhead').style.transform=`translate3d(${beat/4*barWidth}px,0,0)`;syncPlaylistCursorViewport();
 $('#piano-playhead').style.display=phase.active?'block':'none';if(phase.active)$('#piano-playhead').style.transform=`translate3d(${phase.beat/4*pianoBarWidth}px,0,0)`;
}
function renderTransportFrame(at){playheadFrame=null;const tick=engine.positionAt?.(at)||{beat:engine.beat,playing:engine.playing};updateTick(tick);if(tick.playing&&tick.clockAvailable!==false)playheadFrame=requestAnimationFrame(renderTransportFrame);}
function startTransportFrames(){if(playheadFrame===null)playheadFrame=requestAnimationFrame(renderTransportFrame);}
// Default primes its sink/receiver on pointer intent over the transport and rack : the first Space/Play is instant.
document.addEventListener('pointerdown',event=>{if(event.target?.closest?.('#play,#mode,#stop,#rack'))engine.primeTransport?.('pointer-intent');},{passive:true,capture:true});
engine.onTick=t=>{if(t.playing)startTransportFrames();else{if(playheadFrame!==null)cancelAnimationFrame(playheadFrame);playheadFrame=null;updateTick(t);}};engine.onEnded=stop;
async function toggleLoopPlayback(){const scope=playbackUiScope(),clock=await engine.ensureTransportKnown({loop:true});if(scope!==playbackUiScope()||engine.loading)throw Object.assign(new Error('The project changed before its loop could be toggled.'),{name:'AbortError'});if(transportClockUnknown(clock)||typeof clock.loopEnabled!=='boolean')throw new Error('Freestyle has not supplied the current loop state.');
 // Freestyle #17: {enabled} alone keeps / re-loops the saved region; with no region the engine answers 409
 // loop_region_required, and Live's default brace (the first 4 bars) is set and switched on instead.
 try{return await playlistLoop.apply({enabled:!clock.loopEnabled});}
 catch(error){if(clock.loopEnabled||!loopRegionRequired(error))throw error;const bars=4*(Number(project?.beatsPerBar)||4);toast('No loop region yet: looping the first 4 bars.');return playlistLoop.apply({enabled:true,startBeat:0,endBeat:bars});}}
function loopRegionRequired(error){return [error?.code,error?.data?.error?.code,error?.cause?.code].includes('loop_region_required')||/loop_region_required/.test(String(error?.message||''));}

function paintRecordingButton(){
 recording=!!engine.recorder.recording||ablMidiTake.active;const button=$('#record'),starting=engine.recordingContext?.state==='starting'||['connecting','counting-in','arming'].includes(engine.recorder.state),saving=liveTakeStopping||engine.recordingContext?.state==='stopping'||engine.recorder.state==='stopping';
 button.classList.toggle('recording',recording);button.disabled=saving||modeSwitchPending||!!stopRequest;button.setAttribute('aria-busy',String(starting||saving));button.title=saving?'Saving microphone take…':engine.recorder.state==='counting-in'?'Counting in… (click to cancel)':starting?'Cancel microphone connection':ablMidiTake.active?'Stop MIDI recording (one undo step)':recording?'Stop and save microphone recording':'Record (F9): the armed track — microphone for audio tracks, notes for MIDI tracks';button.setAttribute('aria-label',button.title);liveReadOnly?.repaint();
}
/* Arm + ● on a MIDI / instrument track: notes into the open clip (abl-record-input.js AblMidiRecordTake). */
/* Owner bug 5: ● on an armed MIDI track with no clip open used to refuse ("double-click a MIDI clip…"). Live creates the clip:
   a MIDI clip is made at the insert marker on the armed track (one undo step of its own), opened in the Clip View, then the take runs. */
async function ablEnsureMidiTakeClip({laneId}={}){
 const row=(project.cloud?.timelineLaneIds||[]).indexOf(laneId);if(row<0)return false;
 const view=window.ablClipView,shown=view&&(view.kind==='midi'||view.kind==='drum')&&view.clipId!=null?findClip(view.clipId):null;
 if(shown&&shown.track===row)return true;
 /* A MIDI clip shown without an Arrangement placement (opened from Session / the pattern list) keeps receiving the take, as before. */
 if(view&&(view.kind==='midi'||view.kind==='drum')&&!shown)return true;
 const t0=performance.now(),beat=engine.playing?playheadBeatNow():Number.isFinite(editCursorBeat)?editCursorBeat:0,made=await createPatternRegionAt(row,Math.max(0,Number(beat)||0),'midi');if(!made)return false;
 const clip=findClip(made.clipId)||project.clips.find(item=>item.patternId===made.patternId&&item.track===row);if(!clip)return false;
 window.vegetableStudio?.ablShell?.openClip?.(clip);await new Promise(resolve=>setTimeout(resolve,0));clientLog('abl-midi-take-clip',{track:row,ms:Math.round(performance.now()-t0)});return 'created';
}
/* Freestyle #21: a MIDI take from a stopped transport with the metronome menu's Count-In set starts with play
   {count_in_beats, seek_seconds}: the engine clicks the beats (metronome on or off) and rolls the transport one beat after
   the last click; the reply comes on the downbeat. The position display counts in meanwhile. */
async function ablCountInPlay(beats){
 const client=ablStudioClient(),bpm=Number(project.bpm)||120,seek=Math.max(0,(Number(editCursorBeat)||0)*60/bpm);
 if(!client||!engine.ready||!(beats>0))return togglePlay();
 if(mode!=='song')ablSetPlaybackMode('song');
 const since=performance.now();startCountInDisplay({countInBeats:beats,bpm,since});$('#status-message').textContent=`Count-In · ${beats} beat${beats===1?'':'s'}`;
 try{
  const reply=await client.call('play',{path:{project_id:engine.projectId},body:{count_in_beats:beats,seek_seconds:seek}}),response=reply?.data?.response??reply?.data??{};
  clientLog('abl-count-in-play',{beats,replyMs:Math.round(performance.now()-since),transportStarted:response.transport_started??null,startSec:response.start_position_seconds??null,requestId:reply?.data?.requestId??null});
  engine.mode='song';engine.playing=true;$('#play').classList.add('playing');$('#play').textContent='Ⅱ';$('#status-message').textContent=`Playing arrangement · ${project.bpm} BPM`;startTransportFrames();
  return true;
 }catch(error){
  const code=error?.code||error?.data?.error?.code;
  fail(new Error(code==='count_in_cancelled'?'Count-In cancelled (Play, Stop or a seek during the count-in).':code==='transport_rolling'?'The transport is already rolling; stop it before a count-in.':code==='recording_in_progress'?'An audio take is armed; its own count-in applies.':`Count-In failed: ${error.message}`));
  return false;
 }finally{stopCountInDisplay();}
}
const ablMidiTake=new AblMidiRecordTake({ensureClip:ablEnsureMidiTakeClip,clipView:()=>window.ablClipView,playing:()=>!!engine.playing,startTransport:()=>{if(engine.playing)return null;const beats=Number(logicRegionTools?.recordTarget?.()?.countInBeats)||0;return beats>0?ablCountInPlay(beats):togglePlay();},toast,onChange:()=>{try{paintRecordingButton();logicRegionTools?.paintTrackRecord?.();}catch{}}});
/** Studio API live-ingest take stop: take_stop + finalizeRecording (cloud-recorder.js stopStudio), recorded as ONE
 * undo step through the audio-import history controller (Undo removes the take's clip, Redo restores it; the lane's
 * other clips are untouched, as API takes keep existing clips). */
var liveTakeStopping=false;
/* QA r13: the saving state shows on the ■ / ● press frame, not only after the history baseline read. */
async function stopLiveIngestTake(){liveTakeStopping=true;paintRecordingButton();try{return await stopLiveIngestTakeNow();}finally{liveTakeStopping=false;paintRecordingButton();}}
async function stopLiveIngestTakeNow(){
 const context=engine.recordingContext;if(context)context.state='stopping';paintRecordingButton();
 // The take ends where Stop was pressed, not after the history baseline read below.
 const songEndSec=engine.session.positionAt?.()?.seconds;
 const scope=fileImportScope(),assert=()=>{if(JSON.stringify(scope)!==JSON.stringify(fileImportScope())||!engine.ready||engine.loading)throw Object.assign(new Error('The project changed while the take was saving.'),{name:'AbortError'});};
 const read=async()=>{assert();const result=await engine.session.call('get_project',{project_id:scope.projectId});assert();const saved=projectPlaylistCloneRead(engine,result,scope);engine.session.rawProject=saved.rawProject;engine.session.rawState=saved.rawState;engine.session.project=saved.project;engine.accept(saved.project);};
 const history=engine.patternHistory;let controller=null,token=null;
 // Freestyle #4: take_stop + finalize go out on the Stop press; the history baseline is the project as shown (kept
 // current by the interactive session), no longer a read that delayed take_stop by ~1 s.
 try{controller=new AudioImportHistoryController({before:project,getProject:()=>project,getSaved:()=>engine.session.project,getScope:fileImportScope,read,call:(...args)=>engine.session.call(...args),flush:()=>engine.flush(),onChange:()=>mixerView?.render()});token=history?.beginAudioImport?.(controller)??null;}
 catch(error){clientLog('abl-take-history',{stage:'before',message:String(error?.message||error).slice(0,160)});controller=null;token=null;}
 let take;
 try{take=await engine.recorder.stop({songEndSec});}
 catch(error){engine.lastTake=error.recordingTake?{...error.recordingTake,persisted:!!error.recordingTake.final}:engine.lastTake;if(token){controller.failImport({attempted:true,committed:false,uncertain:error.status!==422,explicitRejection:error.status===422,error});history.failAudioImport(token,error);}throw error;}
 finally{if(engine.recordingContext===context)engine.recordingContext=null;}
 engine.lastTake={...take,persisted:true};/* placed (#4): the clip is on the lane; 'save-failed' reports a later refusal */
 // recordedLaneId: Freestyle's take promotion bumps its record lane's identityVersion (live QA r12: 1 → 2); that is
 // the take's own write, so the take stays ONE exact undo step.
 if(token&&take.clipId){try{const after=await controller.fresh();controller.adopt({after,clipId:take.clipId,recordedLaneId:take.laneId});history.finishAudioImport(token);}catch(error){controller.failImport({attempted:true,committed:true,uncertain:false,error});history.failAudioImport(token,error);take.historyError=error.message;clientLog('abl-take-history',{stage:'adopt',message:String(error?.message||error).slice(0,160)});}}
 else{if(token){const error=new Error('Freestyle saved the take without naming its clip.');controller.failImport({attempted:true,committed:true,uncertain:false,error});history.failAudioImport(token,error);take.historyError=error.message;}await engine.refresh().catch(()=>{});}
 audioRangeRevision++;clientLog('abl-live-take',{takeId:take.takeId,clipId:take.clipId,laneId:take.laneId,countIn:take.countIn?.beats??0,history:!take.historyError});
 return take;
}
const NO_ARMED_TRACK_MESSAGE='No track is armed, so ● only plays the Arrangement and records nothing. Arm a track (its ● in the track header) to record a take.';
/** QA r14: a take from a stopped transport starts at the insert marker — the position the display shows — as Live does
 * (Play starts there too). The engine's own clock can sit elsewhere (r14: 6.17 s / 33.6 s while 1.1.1 / 13.3.3 showed). */
function recordStartSec(){const bpm=Number(project?.bpm),beat=Number(editCursorBeat);return Number.isFinite(bpm)&&bpm>0&&Number.isFinite(beat)&&beat>=0?beat*60/bpm:null;}
async function toggleRecord({transportStop=false}={}){
 if(!transportStop&&readOnlyRefusal()&&!recording&&!engine.recordingContext&&!engine.recorder.recording)return toast(readOnlyRefusal());
 if(!transportStop&&(modeSwitchPending||stopRequest))return toast('Wait for playback to stop before recording.');
 if(rangeBusy())return toast('Wait for the current audio range request to finish.');
 if(engine.recordingContext?.state==='stopping'||engine.recorder.state==='stopping')return;
 if(!engine.ready)return toast('Select a cloud project first.');
 try{
  if(engine.recordingContext?.state==='starting'||engine.recorder.state==='connecting'){
   Promise.resolve(engine.cancelRecording()).catch(fail);paintRecordingButton();toast('Microphone connection cancelled.');return;
  }
  if(ablMidiTake.active){ablMidiTake.stop();toast('MIDI take ended.');return;}
  if(engine.recorder.recording&&engine.recorder.mode==='live-ingest'){const take=await stopLiveIngestTake();toast(take.historyError?`Take ${take.saving?'placed':'saved'} in Freestyle (not added to Undo History: ${take.historyError})`:take.saving?'Take placed on the track; Freestyle is finishing the save. ⌘Z removes it.':'Take saved in Freestyle. ⌘Z removes it.');return;}
  const target=logicRegionTools?.recordTarget?.()||{};
  if(!engine.recorder.recording&&target.midi){await ablMidiTake.start({laneId:target.laneId});return;}
  // QA r14: Live's Arrangement ● with no armed track records nothing — it only rolls the transport. Never fall back to
  // recording into the selected / first audio lane.
  if(!engine.recorder.recording&&!engine.recordingContext&&!target.laneId){clientLog('abl-record-unarmed',{playing:!!engine.playing});toast(NO_ARMED_TRACK_MESSAGE);if(!engine.playing&&mode==='song')await togglePlay();return;}
  if(!engine.recorder.recording){engine.recorder.studio=studioRecordingHooks({client:ablStudioClient(),projectId:engine.projectId,countInBeats:()=>target.countInBeats||0,bpm:()=>Number(project.bpm)||null});const starting=engine.startRecording({...target,startSec:recordStartSec()});paintRecordingButton();const result=await starting;paintRecordingButton();toast(result.mode==='capture-upload'?'Recording microphone for upload to Freestyle.':result.mode==='live-ingest'?`Recording into the Freestyle cloud engine${result.countIn?.beats?` (after a ${result.countIn.beats}-beat count-in)`:''}.`:'Recording into the Freestyle cloud engine.');}
  else{const stopping=engine.stopRecording();paintRecordingButton();const result=await stopping;toast(result.currentProject===false?'Recording saved in its original Freestyle project.':result.placementPending||result.liveReloadPending?'Take saved in Freestyle. Its live timeline placement is waiting for engine sync.':'Recording saved in Freestyle.');}
 }catch(error){
  if(error.name!=='AbortError'){
   fail(error);
   if(engine.lastTake?.file&&!engine.lastTake.persisted){const take=engine.lastTake,d=dialog('Captured take',`<p>${esc(error.message)}</p><p>The microphone take remains in memory. Save a copy before closing this tab.</p><button id="recover-take">Save captured audio</button>`);d.querySelector('#recover-take').onclick=()=>download(take.file,take.file.name);}
  }
 }finally{paintRecordingButton();}
}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
async function saveProject(){assertRangeIdle();if(engine.interacting)return toast('Finish the current drag before saving a project snapshot.');await engine.save();toast('Project snapshot saved in Freestyle.');}
rangeEdits=new CloudRangeDialog({getProject:()=>project,cloudCall:(name,args,options)=>engine.session.call(name,args,options),dialog,getScope:()=>({engine:engine.loadVersion||0,session:engine.session.contextVersion||0}),getSelectedIds:()=>playlistSelection.ids,getClock:()=>engine.session.positionAt?.()||{},getEditRevision:()=>audioRangeRevision,flush:()=>engine.flush(),refresh:()=>engine.refresh(),guard:()=>{if(!engine.ready)throw new Error('Select a Freestyle project before editing an audio range.');if(workspaceBusy()||sliceBusy()||sliceUncertain()||cloudLibrary?.writeBusy||engine.loading||engine.applying||engine.interacting||recording||engine.recordingContext||engine.recorder?.recording||engine.recorder?.state==='stopping')throw new Error('Finish the current gesture or cloud operation before editing an audio range.');},onBusyChange:busy=>{document.body.classList.toggle('audio-range-pending',busy);if(!busy)queueRackControlSync();},onStatus:toast});
const sourceEditContext=()=>({projectId:engine.projectId,trackId:engine.session.trackId,loadVersion:engine.loadVersion||0,contextVersion:engine.session.contextVersion||0});
function assertSourceEditAvailable(){assertRangeIdle();if(!engine.ready||engine.loading||engine.applying||engine.interacting||sliceBusy()||rackClipboardBusy||rackGraph?.busy||cloudLibrary?.writeBusy||recording||engine.recorder?.recording)throw new Error('Finish the current edit or recording before editing source audio.');}
async function sourceAudioCommitted(receipt){audioRangeRevision++;clipWaveforms.invalidate(receipt.clip_id||receipt.asset?.clip_id);await engine.refresh();renderAll();}
sampleEditor=new CloudSampleEditorDialog({dialog,call:(name,args,options)=>engine.session.call(name,args,options),getContext:sourceEditContext,guard:assertSourceEditAvailable,onBusyChange:()=>mixerView?.render(),onCommitted:sourceAudioCommitted,onStatus:toast});
async function openSampleEditor(clip){assertSourceEditAvailable();const context=JSON.stringify(sourceEditContext());await engine.flush();if(context!==JSON.stringify(sourceEditContext()))throw new Error('The project changed. Reopen its audio clip menu.');return sampleEditor.open(findClip(clip.id)||clip);}
function assertRegionAvailable(){if(workspaceBusy({ignoreRegionEffects:true})||rangeBusy()||!engine.ready||engine.loading||engine.applying||engine.interacting||sliceBusy()||rackClipboardBusy||rackGraph?.busy||cloudLibrary?.writeBusy||recording||engine.recorder?.recording)throw new Error('Finish the current edit or recording before rendering a region effect.');}
async function prepareRegionMedia(url){const parsed=new URL(url);if(parsed.origin==='https://freestyle.audio'&&/^\/api\/mcp\/listen\/[0-9a-f]{32}\/audio$/.test(parsed.pathname)&&parsed.searchParams.getAll('token').length===1&&parsed.searchParams.get('token')&&[...parsed.searchParams.keys()].every(key=>key==='token')&&!parsed.hash&&!parsed.username&&!parsed.password)return prepareLibraryMedia(parsed.href);return prepareLibraryMedia(url);}
regionEffects=new CloudRegionEffectsDialog({getProject:()=>project,cloudCall:(name,args,options)=>engine.session.call(name,args,options),dialog,getScope:fileImportScope,getEditRevision:()=>audioRangeRevision,flush:()=>engine.flush(),refresh:async()=>{clipWaveforms.invalidate();await engine.refresh();renderAll();},guard:assertRegionAvailable,prepareMedia:prepareRegionMedia,onBusyChange:()=>mixerView?.render(),onStatus:toast,history:()=>engine.patternHistory,
 // QA round 21 speed: in-place Undo paints the cached older source revision at once and
 // confirms from its reply; the timeline-revision read runs off the critical path.
 sourceView:{remember:clipId=>clipWaveforms.rememberRevision(clipId),show:(clipId,revision)=>clipWaveforms.showRevision(clipId,revision),invalidate:clipId=>clipWaveforms.invalidate(clipId),settle:()=>queueCloudWaveforms(),confirmRead:()=>engine.refresh()},log:clientLog});
timingMap=new CloudTimingMap({engine,onChange:()=>{if(mixerView?.active)mixerRenderPending=true;else renderMixer();},onApplied:async()=>{await engine.refresh();renderAll();}});
timingDialog=new CloudTimingMapDialog({controller:timingMap,createDialog:dialog,document,onStatus:toast,isEditable:()=>directLevelEditable()});
function openRangeSafeSaveAs(options){assertRangeIdle();return openSaveAsDialog(options);}
const cloudExport=new CloudExportDialog({getProject:()=>project,engine,dialog,connect:()=>openCloudPanel().catch(fail)});
async function exportWav(){assertRangeIdle();if(engine.interacting)return toast('Finish the current drag before exporting.');return cloudExport.open();}
// File-picker imports have no drop overlay. Keep their whole scoped batch
// visible across flush, ordered uploads/attachment, and the final saved refresh.
function filePickerFeedbackMessage(message){
 const operation=audioImportFeedback;
 if(operation?.active&&operation.scope===JSON.stringify(fileImportScope()))return operation.error||operation.message;
 return historyFeedbackMessage(message);
}
function paintFilePickerProgress(operation,message){
 operation.message=message;if(audioImportFeedback!==operation||operation.scope!==JSON.stringify(fileImportScope()))return;
 const visible=filePickerFeedbackMessage(message);$('#status-message').textContent=visible;$('#hint').textContent=visible;
}
async function importAudioWithHistory(file,target,options,{onImported=null}={}){
 if(engine.session.rawState?.studioApi!==true)return engine.importSample(file,target,options);
 await engine.flush();const scope=fileImportScope(),assert=()=>{if(JSON.stringify(scope)!==JSON.stringify(fileImportScope())||!engine.ready||engine.loading)throw Object.assign(new Error('The project changed during audio import.'),{name:'AbortError'});};
 const read=async()=>{assert();const result=await engine.session.call('get_project',{project_id:scope.projectId});assert();const saved=projectPlaylistCloneRead(engine,result,scope);engine.session.rawProject=saved.rawProject;engine.session.rawState=saved.rawState;engine.session.project=saved.project;engine.accept(saved.project);};
 await read();assert();const controller=new AudioImportHistoryController({before:project,getProject:()=>project,getSaved:()=>engine.session.project,getScope:fileImportScope,read,call:(...args)=>engine.session.call(...args),flush:()=>engine.flush(),onChange:()=>mixerView?.render()}),history=engine.patternHistory,token=history.beginAudioImport(controller);let result;
 try{
  result=await engine.importSample(file,target,options);assert();if(result?.persisted!==true)throw new Error('The audio import has not confirmed its saved clip. Inspect it before importing again.');
  // Presentation hooks (row binding) run before the canonical read renders the result.
  try{onImported?.({...result,createdLane:!options?.laneId&&!(controller.before?.cloud?.rawProject?.lanes||[]).some(lane=>lane.id===result.laneId)});}catch{}
  await controller.fresh();controller.adopt({after:project,clipId:result.clipId});history.finishAudioImport(token);audioRangeRevision++;return result;
 }catch(error){
  const committed=!!result||error.operationCommitted===true,attempted=!!result||error.operationAttempted===true,explicitRejection=error.explicitRejection===true;
  controller.failImport({attempted,committed,uncertain:error.operationUncertain===true||attempted&&!committed&&!explicitRejection,explicitRejection,error});history.failAudioImport(token,error);
  if(committed&&!error.audioImport)error.message=`Audio saved; its import history is unconfirmed. ${error.message} Inspect the saved clip before importing again.`;throw error;
 }
}
// FL: dropping a pattern clip on an empty Playlist row just works. Freestyle
// placements need a saved lane, so this is ONE Undo step: create an audio lane
// (the published createLane kinds are audio/vocal; live pattern placements sit
// on audio lanes), bind it to the dropped row (presentation row hint), then
// PATCH the placement's laneId/startMs with If-Match. Undo moves it back and
// deletes the created lane only while it is still empty and owned; Redo
// restores that same lane identity and moves the clip again.
let laneMoveBusy=false;
function laneMoveError(message,fields={}){return Object.assign(new Error(message),fields);}
async function savedRaw(){await engine.refresh();return engine.session.rawProject;}
function laneMoveKey(){return globalThis.crypto?.randomUUID?.()||`lane-move-${Date.now()}-${Math.random().toString(36).slice(2)}`;}
async function patchPlacementLane(placementId,laneId,startMs){
 const raw=await savedRaw(),row=raw.placements.find(item=>item.id===placementId);if(!row)throw laneMoveError('The moved pattern clip is no longer saved.',{dispatched:false});const scope=fileImportScope();
 await engine.session.action('update_pattern_placement',{placement_id:placementId,placement:{busId:row.busId||'master',laneId,startMs}},{refresh:false,expectedContext:{projectId:scope.projectId,trackId:scope.trackId,contextVersion:engine.session.contextVersion||0},ifMatch:JSON.stringify(raw.timelineRevision),idempotencyKey:laneMoveKey()});
 const after=(await savedRaw()).placements.find(item=>item.id===placementId);if(after?.laneId!==laneId||after.startMs!==startMs)throw laneMoveError('Freestyle has not confirmed the pattern clip on its lane.',{operationUncertain:true});
}
async function laneHistoryCall(name,laneId){
 const raw=await savedRaw(),payload=await engine.session.call(name,{project_id:engine.projectId,lane_id:laneId,...name==='restore_lane'?{clip_ids:[]}:{}},{ifMatch:raw._studioApi?.etag||JSON.stringify(raw.timelineRevision),idempotencyKey:laneMoveKey()}),receipt=payload?.structuredContent?.response??payload?.structuredContent??payload?.response??payload;
 if(name==='delete_lane'&&Array.isArray(receipt?.deletedClipIds)&&receipt.deletedClipIds.length)throw laneMoveError('Freestyle deleted takes with the lane. Inspect the project; nothing will be repeated.',{operationUncertain:true});
 const after=await savedRaw();if(name==='delete_lane'?after.lanes.some(lane=>lane.id===laneId):!after.lanes.some(lane=>lane.id===laneId))throw laneMoveError('Freestyle has not confirmed the lane '+(name==='delete_lane'?'removal.':'restore.'),{operationUncertain:true});
}
function laneOnlyHosts(raw,laneId,placementId){return !raw.clips.some(clip=>clip.laneId===laneId)&&raw.placements.every(row=>row.laneId!==laneId||row.id===placementId)&&!raw.patterns.some(pattern=>(pattern.pattern?.sources||[]).some(source=>source.laneId===laneId));}
async function movePatternToNewRow(clip,state){
 if(laneMoveBusy||workspaceBusy()||engine.patternHistory?.optimisticPending)throw new Error('Wait for the current cloud operation to finish.');
 const placementId=clip.cloudId,row=state.track,startMs=Math.round(state.start*60000/project.bpm),scope=engine.patternHistory.context();laneMoveBusy=true;let laneId=null,moved=false,pending=null;
 // FL: the clip shows on the dropped row at once (a placeholder lane) while
 // Freestyle creates the track and moves it; every project render until then
 // keeps that ghost, and a failure renders Freestyle's truth again.
 const ghost=next=>{const target=next?.clips?.find(item=>item.cloudId===placementId);if(target){target.track=row;target.start=state.start;target.pendingLane=true;}return next;},render=engine.onProject,ghostRender=next=>render(ghost(next));let ghosting=true;engine.onProject=ghostRender;
 const stopGhost=()=>{if(!ghosting)return;ghosting=false;if(engine.onProject===ghostRender)engine.onProject=render;};
 ghost(project);renderPlaylist();clientLog('playlist-new-lane-ghost',{placementId,row});
 try{
  // One external creation step: its lane create and refreshes never drop older Undo steps.
  await engine.flush();pending=engine.patternHistory.beginExternalStep({kind:'lane_move',label:'Move pattern clip to new track'});const before=(await savedRaw()).placements.find(item=>item.id===placementId);if(!before)throw new Error('Reload the pattern clip before moving it.');const original={laneId:before.laneId,startMs:before.startMs};
  toast('Creating a track for that Playlist row…');const created=await laneCreate.create({kind:'audio',name:`Track ${row+1}`});laneId=created.laneId;setLaneRowHint(engine.projectId,laneId,row);
  await patchPlacementLane(placementId,laneId,startMs);moved=true;stopGhost();if(engine.project)render(structuredClone(engine.project));else renderAll();
  const createdLane=structuredClone(engine.session.rawProject?.lanes?.find(lane=>lane.id===laneId)??null);
  // Instant Undo/Redo preview: the clip returns to its lane and the created
  // track disappears (Redo: the same track returns with the clip).
  const previewModel=(direction,raw)=>{const placement=raw.placements?.find(item=>item.id===placementId);if(!placement||!Array.isArray(raw.lanes))return false;if(direction==='undo'){placement.laneId=original.laneId;placement.startMs=original.startMs;raw.lanes=raw.lanes.filter(lane=>lane.id!==laneId);}else{if(!createdLane)return false;if(!raw.lanes.some(lane=>lane.id===laneId))raw.lanes.push(structuredClone(createdLane));placement.laneId=laneId;placement.startMs=startMs;}return true;};
  const undo=async()=>{const raw=await savedRaw(),current=raw.placements.find(item=>item.id===placementId);if(current?.laneId!==laneId||current.startMs!==startMs||!raw.lanes.some(lane=>lane.id===laneId)||!laneOnlyHosts(raw,laneId,placementId))throw laneMoveError('That clip or its new track changed after the move. Undo will not overwrite newer data.',{dispatched:false});await patchPlacementLane(placementId,original.laneId,original.startMs);await laneHistoryCall('delete_lane',laneId);renderAll();return{placementId,laneId:original.laneId};};
  const redo=async()=>{const raw=await savedRaw(),current=raw.placements.find(item=>item.id===placementId);if(current?.laneId!==original.laneId||current.startMs!==original.startMs||raw.lanes.some(lane=>lane.id===laneId))throw laneMoveError('That clip changed after Undo. Redo will not overwrite newer data.',{dispatched:false});await laneHistoryCall('restore_lane',laneId);setLaneRowHint(engine.projectId,laneId,row);await patchPlacementLane(placementId,laneId,startMs);renderAll();return{placementId,laneId};};
  engine.patternHistory.finishExternalStep(pending,{detail:{placementId,fromLane:original.laneId,toLane:laneId,row},undo,redo,previewModel});pending=null;
  toast('Pattern clip moved to a new track.');clientLog('playlist-new-lane-move',{placementId,laneId,row,startMs});
 }catch(error){
  stopGhost();clientLog('playlist-new-lane-move-failed',{placementId,laneId,moved,error:String(error?.message||error).slice(0,200),uncertain:error?.operationUncertain===true});
  // A created-but-unused lane is removed again (it is empty and owned); an
  // uncertain move is left for inspection and never repeated.
  if(laneId&&!moved&&error?.operationUncertain!==true)try{const raw=await savedRaw();if(laneOnlyHosts(raw,laneId,null))await laneHistoryCall('delete_lane',laneId);}catch{}
  await engine.refresh().catch(()=>{});if(pending)engine.patternHistory.failExternalStep(pending,moved?{message:error?.message,operationUncertain:true}:error);pending=null;if(engine.project)render(structuredClone(engine.project));renderAll();throw error;
 }finally{if(pending)engine.patternHistory.failExternalStep(pending,{operationUncertain:true});stopGhost();laneMoveBusy=false;}
}
// FL Playlist track header menu. Routes, item gating and guarded writes live in playlist-track-menu.js.
const playlistTrackActions=new PlaylistTrackActions({read:savedRaw,call:(name,args,options)=>engine.session.call(name,args,options),projectId:()=>engine.projectId});
// Disabelton lane A (abl-track-ops.js): Track Color, track Cut/Copy/Paste, whole-track Split, Main activator, Save Version….
ablLaneColors.configure({projectId:()=>engine.projectId,rowLanes:()=>project.cloud?.timelineLaneIds||[],rawLanes:()=>project.cloud?.rawProject?.lanes||[]});
const ablTrackOps=createAblTrackOps({read:savedRaw,call:(name,args,options)=>engine.session.call(name,args,options),projectId:()=>engine.projectId,laneIds:()=>project.cloud?.timelineLaneIds||[],rawProject:()=>project.cloud?.rawProject,history:()=>engine.patternHistory,flush:()=>engine.flush(),editable:()=>!laneMoveBusy&&playlistTrackEditable(),
 exclusive:async fn=>{if(laneMoveBusy)throw new Error('Wait for the current cloud operation to finish.');laneMoveBusy=true;try{return await fn();}finally{laneMoveBusy=false;}},render:()=>renderAll(),actions:playlistTrackActions,deleteTrack:row=>deletePlaylistTrack(row),afterRestore:(laneId,result)=>{void reloadRestoredLaneChain(laneId,{liveEngine:result?.liveEngine??null});},selectTrack:row=>window.vegetableStudio?.ablShell?.selectTrack?.(row),trackName:row=>project.trackNames?.[row]||`Track ${row+1}`,defaultColor:row=>ablPaletteColor(row),log:(kind,data)=>clientLog(kind,data)});
const ablMainActivator=createMainActivator({masterRow:()=>masterMixerRow(),setMasterGain:(before,value)=>{const row=masterMixerRow();if(!row?.controls?.gain?.enabled)throw new Error('Main gain is unavailable.');return mixerControl({row:structuredClone(row),before,value,scope:mixerScope()},'gain');},log:(kind,data)=>clientLog(kind,data)});
async function ablSaveVersion(name,{render=true}={}){assertRangeIdle();if(engine.interacting)throw new Error('Finish the current drag before saving a version.');const receipt=await createNamedSave({call:(n,a,o)=>engine.session.call(n,a,o),projectId:()=>engine.projectId,flush:()=>engine.flush(),name,render});projectSaves={projectId:null,saves:null,error:null,loading:null,at:0};clientLog('abl-save-version',{render,id:receipt?.id??receipt?.save?.id??null});toast(render?`Version “${String(name).trim()}” saved; its mix renders in Freestyle (File ▸ Open Recent / Revert to ▸ WAV).`:`Version “${String(name).trim()}” saved.`);return receipt;}
function ablDownloadSave(save){const state=saveDownloadState(save);if(!state.available)throw new Error(state.reason);if(!/^https?:\/\//i.test(state.url))throw new Error('This version’s WAV is served only to the Freestyle site; download it from Studio’s Save History.');const a=document.createElement('a');a.href=state.url;a.download=saveWavFilename(save);a.rel='noopener';a.target='_blank';document.body.append(a);a.click();a.remove();clientLog('abl-save-download',{saveId:save?.id??null});return state.url;}
function playlistTrackEditable(){return directLevelEditable()&&coreFileEditable()&&!engine.patternHistory?.optimisticPending&&!engine.patternHistory?.externalPending;}
function playlistTrackMixerRow(laneId){try{return laneId?currentMixerModel().rows.find(row=>row.kind==='lane'&&row.id===laneId)||null:null;}catch{return null;}}
/** The guarded track-menu entries (with their disabled reasons) and handlers; the Live shell relabels them. */
function playlistTrackMenuEntries(row){
 const rows=project.cloud?.timelineLaneIds||[],laneId=rows[row]||null,raw=project.cloud?.rawProject,contents=laneId&&raw?laneContents(raw,laneId):null,mixerRow=playlistTrackMixerRow(laneId),solo=mixerRow?.controls?.solo?.enabled&&mixerRow.values?.solo?.known?!!mixerRow.values.solo.value:null,muted=mixerRow?.controls?.mute?.enabled&&mixerRow.values?.mute?.known?!!mixerRow.values.mute.value:null;
 const handlers={rename:()=>renamePlaylistTrack(row),insert:()=>insertPlaylistTrack(row),duplicate:()=>duplicatePlaylistTrack(row),delete:()=>deletePlaylistTrack(row),'move-up':()=>movePlaylistTrack(row,-1),'move-down':()=>movePlaylistTrack(row,1),mute:()=>togglePlaylistTrackMute(row),solo:()=>togglePlaylistTrackSolo(row)};
 return playlistTrackMenuItems({row,laneId,contents,studioApi:engine.session.rawState?.studioApi===true,displayRows:rows,muted,solo,editable:playlistTrackEditable()}).map(item=>item&&{...item,muted,solo,run:handlers[item.id]});
}
function playlistTrackMenu(event,row){
 const rows=project.cloud?.timelineLaneIds||[],laneId=rows[row]||null,raw=project.cloud?.rawProject,contents=laneId&&raw?laneContents(raw,laneId):null,mixerRow=playlistTrackMixerRow(laneId),solo=mixerRow?.controls?.solo?.enabled&&mixerRow.values?.solo?.known?!!mixerRow.values.solo.value:null,muted=mixerRow?.controls?.mute?.enabled&&mixerRow.values?.mute?.known?!!mixerRow.values.mute.value:null;
 const items=playlistTrackMenuItems({row,laneId,contents,studioApi:engine.session.rawState?.studioApi===true,displayRows:rows,muted,solo,editable:playlistTrackEditable()});
 const handlers={rename:()=>renamePlaylistTrack(row),insert:()=>insertPlaylistTrack(row),duplicate:()=>duplicatePlaylistTrack(row),delete:()=>deletePlaylistTrack(row),'move-up':()=>movePlaylistTrack(row,-1),'move-down':()=>movePlaylistTrack(row,1),mute:()=>togglePlaylistTrackMute(row),solo:()=>togglePlaylistTrackSolo(row)};
 clientLog('playlist-track-menu',{row,laneId,items:items.filter(Boolean).map(item=>({id:item.id,disabled:item.disabled}))});
 menu(event,items.map(item=>item&&[item.label,item.shortcut||'',handlers[item.id],item.disabled,item.reason||'']));
}
function renamePlaylistTrack(row){return textDialog('Rename Track','Track name',project.trackNames?.[row]||`Track ${row+1}`,name=>edit(()=>{project.trackNames||={};project.trackNames[row]=name;}));}
// QA19: Mute takes the Mixer's own route like Solo (one recorded history step,
// mix:apply with the placement echo declared), never a model edit whose save
// the observer takes for an outside change.
/** FL insert box: the mixer row a rack channel is heard on, or null. Its own instrument lane,
 * its declared output lane, a non-Master bus, else the one lane its pattern(s) are placed on
 * (the current pattern for a bound channel; every pattern it is used in for a rack row). */
function rackMixerTarget(channel,model){
 try{
  const member=model?.current?.membership||model?.memberships?.[0]||null,source=channel?.cloudSource||member?.source||null;
  const own=channel?.laneId||(model?.binding?.kind==='plugin'?model.binding.laneId:null)||source?.laneId||source?.outputLaneId||null,busId=source?.busId??null;
  const patternIds=channel?[String(pattern().cloudId||pattern().id)]:[...new Set((model?.memberships||[]).map(item=>String(item.patternId)))];
  // A pattern placed on several lanes is heard on each; FL shows one insert, so take the pattern
  // track (non-audio lane) its earliest placement plays on, else its earliest placement's lane.
  const kinds=new Map((project.cloud?.rawProject?.lanes||[]).map(lane=>[lane.id,lane.kind])),placed=(project.clips||[]).filter(clip=>patternIds.includes(String(clip.patternId))&&clip.laneId).sort((a,b)=>(Number(a.start)||0)-(Number(b.start)||0));
  const preferred=placed.find(clip=>kinds.get(clip.laneId)!=='audio')||placed[0]||null;
  const laneId=own||(busId&&busId!=='master'?null:preferred?.laneId||null),rows=currentMixerModel().rows;
  return laneId?rows.find(row=>row.kind==='lane'&&row.id===laneId)||null:busId&&busId!=='master'?rows.find(row=>row.kind==='bus'&&row.id===busId)||null:null;
 }catch{return null;}
}
function rackMixerNumber(target){if(!target)return'-';const index=currentMixerModel().rows.findIndex(row=>row.key===target.key);return index>=0?String(index+1):'-';}
/** The saved lane's known mute for a Playlist row, or null (no lane / not known). */
function playlistTrackLaneMute(row){const target=playlistTrackMixerRow(project.cloud?.timelineLaneIds?.[row]);return target?.controls?.mute?.enabled&&target.values?.mute?.known?!!target.values.mute.value:null;}
// The LED SHOWS the lane's known mute even while its control is busy (a save or a history
// step in flight disables it): otherwise an optimistic Undo fell back to the stale row.
function playlistTrackLedOff(row){const target=playlistTrackMixerRow(project.cloud?.timelineLaneIds?.[row]);if(target?.controls?.mute?.supported!==false&&target?.values?.mute?.known)return !!target.values.mute.value;const lane=playlistTrackLaneMute(row);return lane===null?!!project.mutedTracks?.includes(row):lane;}
function togglePlaylistTrackMute(row){const laneId=project.cloud?.timelineLaneIds?.[row],target=playlistTrackMixerRow(laneId);if(!target?.controls?.mute?.enabled||!target.values?.mute?.known)throw new Error('Open the Mixer for this track to mute it.');const before=!!target.values.mute.value;return mixerControl({row:structuredClone(target),before,value:!before,scope:mixerScope()},'mute');}
function togglePlaylistTrackSolo(row){const laneId=project.cloud?.timelineLaneIds?.[row],target=playlistTrackMixerRow(laneId);if(!target?.controls?.solo?.enabled||!target.values?.solo?.known)throw new Error('Open the Mixer for this track to solo it.');const before=!!target.values.solo.value;return mixerControl({row:structuredClone(target),before,value:!before,scope:mixerScope()},'solo');}
async function insertPlaylistTrack(row){
 requireUiFeature('create_audio_lane');if(!playlistTrackEditable())throw new Error('Wait for the current cloud operation to finish.');
 const occupied=!!project.cloud?.timelineLaneIds?.[row];let laneId=null;toast('Inserting a track…');
 // The row hint is stored as soon as the lane id is known, before the confirming read renders it.
 await createLaneWithHistory({kind:'audio',name:`Track ${row+1}`},{onCreated:id=>{laneId=id;setLaneRowHint(engine.projectId,id,row,{insert:occupied});}});
 renderAll();clientLog('playlist-track-insert',{row,laneId,insert:occupied,renderedRow:laneId?(project.cloud?.timelineLaneIds||[]).indexOf(laneId):null});toast('Track inserted.');
}
/* QA r5: restore_lane (Undo of Delete Track, Redo of Insert Track) saves the lane but a MIDI/LABS/plugin lane came
   back without its live chain (list_plugins → lane_has_no_live_chain). Load it into the running session in the
   background the way the insert path does; the restore itself stays the confirmed history step. */
function reloadRestoredLaneChain(laneId,{liveEngine=null,name=null}={}){
 /* QA r6 / engine request N: load_lane_chain is execute_pro_action (session.call has no v1 op for it) and skips the
    instrument, so read list_plugins and fall back to a full engine reload (never while playing). */
 const scope=JSON.stringify(fileImportScope()),lanes=()=>engine.session.rawProject?.lanes||[],lane=lanes().find(item=>item?.id===laneId);
 const isCurrent=()=>scope===JSON.stringify(fileImportScope())&&lanes().some(item=>item?.id===laneId);
 const listPlugins=()=>{const controller=new MixerToolsController({...scopedMixerOptions({id:laneId,laneId},{historyStep:true}),inventory:null});return controller.call('list_plugins',{...controller.context(),lane_id:laneId});};
 return restoreLaneLiveChain({laneId,lane,name,liveEngine,instrumentTypes:logicInstrumentTypes(),isCurrent,listPlugins,
  loadChain:()=>engine.session.action('load_lane_chain',{lane_id:laneId},{refresh:false}),
  reload:()=>fullEngineReload(engine,{isCurrent}),isPlaying:()=>!!engine.playing,status:text=>engine.onStatus?.(text),log:clientLog
 }).then(result=>{if(result.status==='live'&&result.chainLoaded)engine.session.refresh?.({native:true})?.catch?.(()=>{});else if(result.status==='chain_failed')toast(`${lane?.name||'The track'} is restored, but its effects did not load in the running session. Reload the project to hear them.`);else if(result.status==='unknown')toast(`${lane?.name||'The track'} is restored; its instrument could not be checked in the running session (${result.readError||'no reply'}).`);return result;});
}
async function deletePlaylistTrack(row){
 if(laneMoveBusy||!playlistTrackEditable())throw new Error('Wait for the current cloud operation to finish.');
 const laneId=project.cloud?.timelineLaneIds?.[row];if(!laneId)throw new Error('This Playlist row has no saved track.');
 const shown=laneContents(project.cloud.rawProject,laneId),name=project.trackNames?.[row]||`Track ${row+1}`;
 // Live deletes a track at once (no confirmation): it is one undoable step. A refusal is known up front — never a dialog.
 const blocked=deleteBlockReason(shown);if(blocked)throw new Error(blocked);
 laneMoveBusy=true;let pending=null,state=null;
 try{
  await engine.flush();pending=engine.patternHistory.beginExternalStep({kind:'lane_delete',label:'Delete Track'});
  state=await playlistTrackActions.deleteLane(laneId);renderAll();
  const undo=async()=>{const result=await playlistTrackActions.restoreLane(state);renderAll();clientLog('playlist-track-restore',{laneId,clipIds:result.clipIds.length,liveApplied:result.liveEngine?.applied??null,chainRestored:result.liveEngine?.chainRestored??null,reason:result.liveEngine?.reason??null});void reloadRestoredLaneChain(laneId,{liveEngine:result.liveEngine});if(result.liveChainRestored===false)toast(`${name} is restored, but its effects did not reload in the running session. Reload the project to hear them.`);return result;};
  const redo=async()=>{const next=await playlistTrackActions.deleteLane(laneId,{expect:state});state=next;renderAll();return{laneId,clipIds:next.clipIds};};
  engine.patternHistory.finishExternalStep(pending,{detail:{laneId,row,clipIds:state.clipIds},undo,redo});pending=null;
  const channels=state.patternChannels?.length||0;clientLog('playlist-track-delete',{row,laneId,clipIds:state.clipIds.length,patternChannels:channels});toast(`${name} deleted${channels?` with the ${channels} pattern channel${channels===1?'':'s'} that played it (⌘Z restores ${channels===1?'it':'them'})`:''}.`);return state;
 }catch(error){clientLog('playlist-track-delete-failed',{row,laneId,error:String(error?.message||error).slice(0,200),uncertain:error?.operationUncertain===true});if(pending)engine.patternHistory.failExternalStep(pending,error);pending=null;await engine.refresh().catch(()=>{});renderAll();throw error;}
 finally{if(pending)engine.patternHistory.failExternalStep(pending,{operationUncertain:true});laneMoveBusy=false;}
}
/** Logic Track ▸ New Track with Duplicate Settings (⌘D) over Freestyle duplicateLane: one
 * history step whose Undo deletes the duplicate (deleteLane) and whose Redo restores that
 * same lane with its takes (restoreLane), never a second duplicate. */
async function duplicatePlaylistTrack(row){
 if(laneMoveBusy||!playlistTrackEditable())throw new Error('Wait for the current cloud operation to finish.');
 const laneId=project.cloud?.timelineLaneIds?.[row];if(!laneId)throw new Error('This row has no saved track.');
 const blocked=duplicateBlockReason(laneContents(project.cloud.rawProject,laneId));if(blocked)throw new Error(blocked);
 const name=project.trackNames?.[row]||`Track ${row+1}`;laneMoveBusy=true;let pending=null,created=null,removed=null;
 try{
  await engine.flush();pending=engine.patternHistory.beginExternalStep({kind:'lane_duplicate',label:'New Track with Duplicate Settings'});
  created=await playlistTrackActions.duplicateLane(laneId);renderAll();
  const undo=async()=>{removed=await playlistTrackActions.deleteLane(created.laneId,{duplicate:created});renderAll();return{laneId:created.laneId,clipIds:removed.clipIds};};
  const redo=async()=>{if(!removed)throw new Error('Redo needs the removed duplicate track.');const result=await playlistTrackActions.restoreLane(removed);renderAll();return result;};
  engine.patternHistory.finishExternalStep(pending,{detail:{laneId:created.laneId,sourceLaneId:laneId,row},undo,redo});pending=null;
  const newRow=(project.cloud?.timelineLaneIds||[]).indexOf(created.laneId);if(newRow>=0)logicShell?.selectTrack?.(newRow);
  clientLog('playlist-track-duplicate',{row,laneId,newLaneId:created.laneId,renderedRow:newRow});toast(`${name} duplicated.`);return created;
 }catch(error){clientLog('playlist-track-duplicate-failed',{row,laneId,error:String(error?.message||error).slice(0,200),uncertain:error?.operationUncertain===true});if(pending)engine.patternHistory.failExternalStep(pending,error);pending=null;await engine.refresh().catch(()=>{});renderAll();throw error;}
 finally{if(pending)engine.patternHistory.failExternalStep(pending,{operationUncertain:true});laneMoveBusy=false;}
}
/** Logic track-header drag: move the track at `row` to insertion boundary `to` (one Undo step). */
function dragPlaylistTrack(row,to){return movePlaylistTrack(row,0,to);}
async function movePlaylistTrack(row,delta,to=null){
 if(laneMoveBusy||!playlistTrackEditable())throw new Error('Wait for the current cloud operation to finish.');
 const displayed=[...(project.cloud?.timelineLaneIds||[])],next=to===null?moveRow(displayed,row,delta):moveRowTo(displayed,row,to);if(!next)return null;
 const projectId=engine.projectId,hints=laneRowHints(projectId);laneMoveBusy=true;let pending=null;
 // The displayed layout (row hints included) becomes the saved order, so the hints are no longer needed;
 // Undo puts back the previous saved order and hints exactly.
 const apply=async(rows,expectedRows,restoreHints)=>{const result=await playlistTrackActions.reorder(rows,{expectedRows});replaceLaneRowHints(projectId,restoreHints);renderAll();return result;};
 try{
  await engine.flush();const before=savedRowOrder(await savedRaw());pending=engine.patternHistory.beginExternalStep({kind:'lane_reorder',label:to!==null?'Move Track':delta<0?'Move Track Up':'Move Track Down'});
  const done=await apply(next,before,new Map());const after=done.rows;
  engine.patternHistory.finishExternalStep(pending,{detail:{laneId:displayed[row],row,delta},undo:()=>apply(before,after,hints),redo:()=>apply(next,before,new Map())});pending=null;
  clientLog('playlist-track-move',{row,delta,laneId:displayed[row],renderedRow:(project.cloud?.timelineLaneIds||[]).indexOf(displayed[row])});return done;
 }catch(error){if(pending)engine.patternHistory.failExternalStep(pending,error);pending=null;await engine.refresh().catch(()=>{});renderAll();throw error;}
 finally{if(pending)engine.patternHistory.failExternalStep(pending,{operationUncertain:true});laneMoveBusy=false;}
}
async function createLaneWithHistory(options,{instrument=false,onCreated=null,history:historyOverride=null}={}){
 const create=()=>instrument?emptyInstrument.create(options):laneCreate.create(options);
 if(engine.session.rawState?.studioApi!==true)return create();
 await engine.flush();const scope=fileImportScope(),assert=()=>{if(JSON.stringify(scope)!==JSON.stringify(fileImportScope())||!engine.ready||engine.loading)throw Object.assign(new Error('The project changed during track creation.'),{name:'AbortError'});};
 const read=async()=>{assert();const result=await engine.session.call('get_project',{project_id:scope.projectId});assert();const saved=projectPlaylistCloneRead(engine,result,scope);engine.session.rawProject=saved.rawProject;engine.session.rawState=saved.rawState;engine.session.project=saved.project;engine.accept(saved.project);};
 await read();assert();const controller=new LaneCreateHistoryController({before:project,/* QA r4: the saved model, never an optimistic ⌘Z preview of the display */getProject:()=>engine.project||project,getScope:fileImportScope,read,call:(...args)=>engine.session.call(...args),flush:()=>engine.flush(),onChange:()=>mixerView?.render(),onRestored:id=>{void reloadRestoredLaneChain(id);}}),history=historyOverride||engine.patternHistory,token=history.beginLaneCreate(controller);let receipt;
 try{
  receipt=await create();assert();const laneId=receipt?.laneId??receipt?.lane?.id;try{if(laneId)onCreated?.(laneId);}catch{}if(instrument?receipt?.emptyConfirmed!==true:receipt?.status!=='confirmed')throw new Error('The new track has not confirmed its saved empty lane. Inspect tracks before creating another.');
  // QA r4 speed (lead-approved): the saved lane is adopted as its ⌘Z step right after the create confirms
  // (one canonical read). Loading its native chain and the native read run in the background afterwards;
  // the step stays valid either way because Undo deletes the saved lane. A background failure is reported.
  const nativeInit=instrument?null:async()=>{
   const initialized=await engine.session.action('load_lane_chain',{lane_id:laneId,...(typeof receipt.lane?.name==='string'&&receipt.lane.name?{name:receipt.lane.name}:{})},{refresh:false});assert();
   if(initialized?.ok!==true||initialized.lane_id!==laneId||!Number.isSafeInteger(initialized.mozart_track_id)||initialized.mozart_track_id<0||!Array.isArray(initialized.plugins)||!Array.isArray(initialized.skipped)||initialized.skipped.length)throw new Error('The track is saved, but its native chain initialization is unconfirmed. Inspect tracks before using its history.');
   /* background: read the native state from this refresh's own result (a concurrent canonical refresh may replace session.rawState) */
   const refreshed=await engine.session.refresh({native:true});assert();const state=refreshed?.cloud?.rawState??engine.session.rawState,loaded=state?.session,collection=state?.tracks,rows=collection?.tracks,matches=Array.isArray(rows)?rows.filter(row=>row?.db_track_id===laneId):[],restore=loaded?.instrument_restore;
   if(state?.studioApi!==true||state.projectId!==scope.projectId||loaded?.projectId!==scope.projectId||loaded.ok!==true||loaded.fullyLoaded!==true||collection?.ok!==true||collection.live!==true||collection.runtime_ids_available!==true||matches.length!==1||!Number.isSafeInteger(matches[0].id)||matches[0].id<0||matches[0].pending_restore===true||matches[0].restore_failed===true||rows.filter(row=>row?.id===matches[0].id).length!==1||restore&&(restore.settled!==true||restore.pending!==0||restore.failed!==0))throw new Error('The track is saved, but its native initialization is unconfirmed. Inspect tracks before using its history.');
  };
  // QA r3: a still-loading LABS plug-in is runtime state, not an uncertain save. The canonical read below
  // proves exactly one new empty saved lane, so ⌘Z owns it now (it used to fence all history until reload).
  await controller.fresh();controller.adopt({after:project,laneId});history.finishLaneCreate(token);audioRangeRevision++;
  // Non-enumerable: receipts are structuredClone'd by the dialog, and a Promise cannot be cloned.
  if(nativeInit){const started=performance.now();Object.defineProperty(receipt,'nativeInit',{configurable:true,enumerable:false,value:nativeInit().then(()=>{clientLog('lane-create-native-init',{laneId,ok:true,ms:Math.round(performance.now()-started)});return true;},error=>{
   const current=JSON.stringify(scope)===JSON.stringify(fileImportScope()),present=current&&(engine.project?.cloud?.rawProject?.lanes||[]).some(lane=>lane?.id===laneId);
   clientLog('lane-create-native-init',{laneId,ok:false,present,ms:Math.round(performance.now()-started),error:String(error?.message||error).slice(0,200)});
   // Shown after the New Tracks dialog settles, so its "Track added." cannot replace this warning.
   if(present&&error?.name!=='AbortError'){const message=`Track saved (⌘Z removes it), but its effects did not load in the running session. Reload the project to hear them. ${error?.message||''}`.trim();let tries=0;const show=()=>{if(laneCreateDialog?.pending&&++tries<200){setTimeout(show,50);return;}toast(message);$('#status-message').textContent=message;};show();}
   return false;})});}
  return receipt;
 }catch(error){
  // Playbook §4: only an unknown outcome blocks history. Resolve it from one canonical read: exactly one new
  // empty lane (the one acknowledged, when known) with nothing else changed → adopt it as this ⌘Z step.
  // A lane that is absent may still be in flight, so that case keeps the original uncertain fence.
  let adopted=false,savedIds=null;const ackedId=receipt?.laneId??receipt?.lane?.id??null;
  if(receipt&&error?.name!=='AbortError'&&!controller.busy&&controller.snapshot().status==='idle')try{
   const after=await controller.fresh(),added=after.lanes.filter(lane=>!controller.before.lanes.some(old=>old.id===lane.id));savedIds=added.map(lane=>lane.id);
   if(added.length===1&&(!ackedId||added[0].id===ackedId)){controller.adopt({after,laneId:added[0].id});history.finishLaneCreate(token);audioRangeRevision++;adopted=true;}
  }catch{}
  // QA r4: the canonical read shows the saved lane but it cannot be owned as a step (adopt refused).
  // The outcome is KNOWN, so record nothing and keep every other step usable — never a dead journal.
  if(!adopted&&savedIds?.length&&(!ackedId||savedIds.includes(ackedId))&&typeof history.releaseLaneCreate==='function'){
   controller.failCreate({attempted:true,committed:true,uncertain:false,error});if(history.releaseLaneCreate(token,error)){clientLog('lane-create-reconciled',{outcome:'unowned',laneId:ackedId,error:error.message});error.message=`Track saved, but this insert is not in Undo history. ${error.message}`;throw error;}
  }
  if(adopted){clientLog('lane-create-reconciled',{outcome:'adopted',laneId:ackedId,error:error.message});error.message=`Track saved (⌘Z removes it). ${error.message}`;throw error;}
  const entry=error.instrumentReceipt??error.laneReceipt??receipt,status=entry?.status,attempted=!!receipt||entry?.createSent===true||['acknowledged','confirmed','saved_unconfirmed','rejected','conflict','uncertain'].includes(status),committed=!!receipt||status==='saved_unconfirmed',explicitRejection=error.operationUncertain!==true&&(error.explicitRejection===true||['rejected','conflict'].includes(status));
  controller.failCreate({attempted,committed,uncertain:error.operationUncertain===true||attempted&&!committed&&!explicitRejection,explicitRejection,error});history.failLaneCreate(token,error);if(committed)error.message=`Track saved; its history is unconfirmed. ${error.message} Inspect tracks before creating another.`;throw error;
 }
}
$('#import-audio').onchange=async event=>{
 const input=event.target,files=Array.from(input.files),target=importedTarget;
 if(workspaceBusy()||!coreFileEditable()){input.value='';importedTarget=null;return toast('Wait for the current cloud operation to finish.');}
 if(!files.length){input.value='';importedTarget=null;return;}
 // The Rack's sample picker uploads sample-only Rack channels; ordinary
 // File→Import (no Rack target) keeps the Playlist take import below.
 if(target!=null&&rackUploadSupported()){const rackScope=JSON.stringify(fileImportScope());importedTarget=null;input.value='';try{await uploadFilesToRack(files,{check:()=>{if(!engine.ready||engine.loading||JSON.stringify(fileImportScope())!==rackScope)throw new Error('The project changed. Remaining files were not uploaded.');}});}catch(error){fail(error);}return;}
 const scope=fileImportScope(),current=()=>engine.ready&&!engine.loading&&JSON.stringify(fileImportScope())===JSON.stringify(scope);
 const check=()=>{if(!current())throw new Error('The audio import project changed. Remaining files were not uploaded.');if(workspaceBusy({ignoreAudioImport:true})||!coreFileEditable({ignoreAudioImport:true}))throw new Error('Finish the current cloud operation before continuing this audio import.');};
 audioImportBusy=true;const feedback={scope:JSON.stringify(scope),active:true,error:null,message:''};audioImportFeedback=feedback;let pending=0,completed=0;
 paintFilePickerProgress(feedback,`Preparing audio import · ${files.length} file${files.length===1?'':'s'}…`);
 try{
  await engine.flush();check();
  for(const file of files){
   check();paintFilePickerProgress(feedback,`Importing audio ${completed+1} of ${files.length}…`);const result=await importAudioWithHistory(file,target);check();completed++;if(result?.attachmentPending)pending++;
  }
  check();paintFilePickerProgress(feedback,`Confirming ${completed} imported audio file${completed===1?'':'s'} in Freestyle…`);await engine.refresh();check();feedback.active=false;
  const message=pending?`${completed} audio file${completed===1?'':'s'} saved; live loading is unconfirmed for ${pending}. Inspect the saved clips before importing again.`:`${completed} audio file${completed===1?'':'s'} uploaded to Freestyle.`;toast(message);$('#hint').textContent=message;
 }catch(error){feedback.error=error.message||String(error);if(feedback.scope===JSON.stringify(fileImportScope())){paintFilePickerProgress(feedback,feedback.message);fail(error);}else{console.error(error);if($('#status-message').textContent===feedback.message){$('#status-message').textContent=feedback.error;if($('#hint').textContent===feedback.message)$('#hint').textContent=feedback.error;}}}
 finally{feedback.active=false;if(audioImportFeedback===feedback)audioImportFeedback=null;audioImportBusy=false;importedTarget=null;input.value='';mixerView?.render();}
};
$('#import-project').accept='.flp,.zip,.logicx';$('#import-project').onchange=async e=>{if(workspaceBusy()){e.target.value='';return toast('Wait for the current cloud operation to finish.');}if(rangeBusy())return toast('Wait for the current audio range request to finish.');const file=e.target.files[0];if(file){try{let format;if(/\.zip$/i.test(file.name)){const d=dialog('Import cloud DAW project',`<p>Choose the type of project inside this ZIP.</p><button id="zip-fl">FL Studio loop package</button><button id="zip-logic">Logic project bundle</button>`);format=await new Promise(resolve=>{d.querySelector('#zip-fl').onclick=()=>{resolve('flp');d.close();};d.querySelector('#zip-logic').onclick=()=>{resolve('logic');d.close();};d.addEventListener('close',()=>resolve(null));});if(!format)return;}assertRangeIdle();await engine.importDawProject(file,format);toast('DAW project imported in Freestyle.');}catch(error){fail(error);}}e.target.value='';};
async function midiExport(){const {encodeMidi}=await import('./midi.js');download(encodeMidi(project,mode),project.title+'.mid');toast('Standard MIDI file exported.');}
async function midiImport(file,{fromDrop=false}={}){if(fromDrop){if(!coreFileEditable())throw new Error('Finish the current operation before importing MIDI.');}else assertRangeIdle();const input=document.createElement('input');input.type='file';input.accept='.mid,.midi';input.onchange=async()=>{try{const {decodeMidi}=await import('./midi.js'),data=decodeMidi(await (file||input.files[0]).arrayBuffer());if(!data.channels.length)throw new Error('This MIDI file contains no playable notes.');if(!engine.ready)throw new Error('Load a Freestyle cloud project first.');const instruments=project.channels.filter(c=>c.type==='instrument'||c.instrumentType),sourcePattern=data.patterns[0];const d=dialog('Import MIDI into Freestyle',`<p>${countLabel(data.channels.length,'MIDI track')} · ${data.bpm} BPM. Assign each part to an existing cloud instrument, create a cloud instrument, or skip it.</p>${data.channels.map((c,i)=>`<label>${esc(c.name||`MIDI track ${i+1}`)}</label><select data-midi-target="${esc(c.id)}"><option value="">Skip this part</option><option value="new" ${instruments.length===0?'selected':''}>Create a cloud instrument (${esc(c.type||'keys')})</option>${instruments.map((target,j)=>`<option value="${esc(target.id)}" ${i===j?'selected':''}>${esc(target.name)}</option>`).join('')}</select>`).join('')}<button id="midi-send" class="primary">Import selected MIDI parts</button><p id="midi-progress"></p>`);d.querySelector('#midi-send').onclick=async()=>{const button=d.querySelector('#midi-send'),targetPatternId=pattern().id,scope={projectId:engine.projectId,trackId:engine.session.trackId,loadVersion:engine.loadVersion||0,contextVersion:engine.session.contextVersion||0};const checkImport=()=>{assertRangeIdle();if(!d.isConnected||!engine.ready||engine.loading||engine.projectId!==scope.projectId||engine.session.trackId!==scope.trackId||(engine.loadVersion||0)!==scope.loadVersion||(engine.session.contextVersion||0)!==scope.contextVersion)throw new Error('The MIDI import context changed. Inspect completed parts before starting a new import.');};let writeAttempted=false;button.disabled=true;try{await engine.flush();checkImport();const mappings=[...d.querySelectorAll('[data-midi-target]')].map(el=>({source:data.channels.find(c=>c.id===el.dataset.midiTarget),target:el.value})).filter(x=>x.target);if(!mappings.length)throw new Error('Choose at least one MIDI part.');const assigned=mappings.filter(m=>m.target!=='new').map(m=>{const channel=project.channels.find(c=>c.id===m.target);return channel?.laneId||m.target;});if(new Set(assigned).size!==assigned.length)throw new Error('Assign different MIDI parts to different existing cloud instruments.');let count=0;for(const m of mappings){checkImport();const notes=sourcePattern.notes?.[m.source.id]||[];if(!notes.length)continue;d.querySelector('#midi-progress').textContent=`Importing ${++count}/${mappings.length}: ${m.source.name}…`;if(m.target==='new'){const role={bass:'synth_bass',pad:'pad',piano:'piano'}[m.source.type]||'keys';writeAttempted=true;await engine.session.action('add_instrument_track',{role,name:m.source.name,pattern_name:m.source.name,notes:notes.map(n=>({pitch:n.pitch,bar:Math.floor(n.start/4)+1,step:(n.start%4)*4+1,length_steps:n.duration*4,velocity:n.velocity})),bars:sourcePattern.bars,place_at_measure:1,repeat:1});}else{const c=project.channels.find(c=>c.id===m.target);const target=engine.session.project?.patterns?.find(p=>p.id===targetPatternId);if(!target)throw new Error('The MIDI target pattern is no longer present. Reopen the import dialog.');writeAttempted=true;await engine.session.writeInstrumentNotesCanonical(target,c,notes,{bars:sourcePattern.bars,replace:true});}}checkImport();await engine.refresh();checkImport();d.close();toast(`${countLabel(count,'MIDI part')} imported into Freestyle.`);}catch(e){d.querySelector('#midi-progress').textContent=e.message+(writeAttempted?' Inspect the cloud pattern before reopening this import.':'');}finally{button.disabled=writeAttempted;}};}catch(e){fail(e);}};if(file)return input.onchange();input.click();}
function publishDialog(){openCloudPanel().catch(fail);}
function projectInfo(){textDialog('Project information','Project title',project.title,title=>edit(()=>project.title=title));}
function showHistory(){try{requireUiFeature('native_history_panel');}catch(error){fail(error);return;}engine.session.action('get_history',{project_id:engine.projectId}).then(data=>dialog('Cloud undo history',`<pre style="white-space:pre-wrap;font-size:10px;max-height:400px;overflow:auto">${esc(JSON.stringify(data,null,2))}</pre>`)).catch(fail);}
function libraryDragDiagnosticLines(){
 const {counters,recent,gesture}=libraryDragDiagnostics.snapshot();
 return [`Browser sample drag: presses ${counters.pointerdown}, starts ${counters.dragstart}, overs ${counters.dragover}, drops ${counters.drop}, ends ${counters.dragend}`,
 `Browser drag source: ${gesture?.sourceEditor??'none'} · draggable ${gesture?.sourceDraggable??false} · connected ${gesture?.sourceConnected??false}`,
 ...recent.slice(-6).map(row=>`Drag ${Math.round(row.at)}ms ${row.type}: ${row.destinationEditor??'outside'}/${row.targetTag} · lane ${row.laneGrid} · MIME ${row.customMime} · trusted ${row.isTrusted} · prevented ${row.defaultPrevented}`)];
}
function connectionDiagnostics(){
 const d=dialog('Connection and interaction diagnostics','<pre class="connection-diagnostics" style="white-space:pre-wrap;font-size:12px;line-height:1.7"></pre>');
 const audioErrorField=key=>{const value=engine.monitor.lastError?.[key];return typeof value==='string'?value.replace(/[\r\n\t]/g,' ').slice(0,160):typeof value==='number'&&Number.isFinite(value)?String(value):'—';};
 const paint=()=>{const m=engine.monitor,t=$('#arrangement-scroll'),p=$('#piano-scroll'),clock=engine.positionAt?.()||{},interactive=engine.interactive?.snapshot(),transport=engine.transportControl?.lastResult;const pat=patternPreviewDiagnostics({receipt:engine.previewReceipt,context:engine.previewContext,session:engine.session,monitor:m,previewing:engine.previewing});d.querySelector('pre').textContent=[`PAT clock: ${pat.reason.replaceAll('-',' ')} · preview ${pat.previewing?'active':'stopped'} · peer match ${pat.generationMatches?'yes':'no'} · expected epoch ${pat.expectedEpoch??'?'}`,`PAT program: ${pat.receipt.programActive??'?'} · repeats ${pat.receipt.repeatCount??'?'} · initial ${pat.receipt.initialCycles??'?'} · cycle ${pat.receipt.cycleSec??'?'} s · duration ${pat.receipt.durationSec??'?'} s`,`PAT schedule: ${pat.receipt.scheduleTimeSec??'?'} s · samples ${pat.receipt.scheduledSamples??'?'} · MIDI ${pat.receipt.scheduledMidi??'?'} · complete ${pat.receipt.complete??'?'}`,...Object.entries(pat.anchors).map(([name,a])=>`PAT ${name.toUpperCase()}: ${a.present?'present':'absent'} · age ${a.ageMs??'?'} ms · device ${a.deviceSample?'yes':'no'} · rate ${a.sampleRate?'yes':'no'} · project ${a.projectMatches===null?'?':a.projectMatches?'match':'different'} · epoch ${a.epoch??'?'}`),...libraryDragDiagnosticLines(),...clipGestureDiagnosticLines(),`Cloud audio: ${m.state}`,`Interactive session: ${interactive?.status||'unavailable'} · revision ${interactive?.revision??'—'} · pending ${interactive?.pending?.length||0}`,`Interactive error: ${interactive?.errorCode||engine.interactiveConnectError?.code||'none'} · ${interactive?.errorStage||engine.interactiveConnectError?.stage||'—'} · ${interactive?.reason||interactive?.error||engine.interactiveConnectError?.message||'none'}`,`Engine scope: ${engine.projectId} / ${engine.session.trackId} · ready ${engine.ready} · loading ${!!engine.loading}`,`Monitor scope: ${m.projectId||'none'} / ${m.trackId||'none'} · generation ${m.generation}`,`Play request: ${engine.playAttempt?JSON.stringify(engine.playAttempt):'none'} · playing ${engine.playing} / session ${engine.session.playing}`,`Transport response: ${transport?`${transport.command} · ${transport.route==='mcp'?'HTTP':transport.route} · ${Math.round(transport.elapsedMs)} ms · ${!transport.ok?'failed':transport.acknowledged?'acknowledged':transport.recoveredFromClock?'confirmed by clock':transport.reconciled?'reconciled':'complete'}${transport.reason?' · '+transport.reason:''}`:'none'}`,`Last operation error: ${lastOperationError?.message||'none'}`,`Last audio error: ${m.lastError?.message||'none'}`,`Audio error details: ${['code','status','stage','engineStatus','upstreamRequestId'].map(key=>`${key}=${audioErrorField(key)}`).join(' · ')}`,`WebRTC: ${m.peer?.connectionState||'idle'} · ICE: ${m.peer?.iceConnectionState||'idle'}`,`Cloud controls: ${m.control?.readyState||'closed'}`,`Playback clock: ${clock.clockSource||'none'} · age ${Math.round(clock.clockAgeMs||0)} ms · heard lag ${Math.round((clock.heardLagSec||0)*1000)} ms`,`Loop: ${clock.loopEnabled?'on':'off'} · ${clock.loopStartSec??'—'} → ${clock.loopEndSec??'—'} s`,`Received audio: ${m.stats.bytesReceived} bytes · level ${m.stats.audioLevel.toFixed(4)}`,`Packets lost: ${m.stats.packetsLost} · jitter ${(m.stats.jitter*1000).toFixed(1)} ms · round trip ${(m.stats.roundTripTime*1000).toFixed(1)} ms`,`Media: ${m.audio?.srcObject?(m.audio.paused?'paused':'playing'):'no stream'} · ${m.audio?.srcObject?.getAudioTracks?.().map(t=>t.readyState).join(', ')||'no audio track'}`,`Draggable windows: ${windows.registrations.size} · drags ${windows.starts} (${windows.lastWindow}) · pointer moves ${windows.moves} · painted frames ${windows.frames}`,`Timeline: x ${Math.round(t.scrollLeft)} / ${Math.max(0,t.scrollWidth-t.clientWidth)}, y ${Math.round(t.scrollTop)} / ${Math.max(0,t.scrollHeight-t.clientHeight)}`,`Timeline zoom: ${barWidth.toFixed(2)} px/bar · ${timelineViewport.frames} zoom frames`,`Piano roll: x ${Math.round(p.scrollLeft)}, y ${Math.round(p.scrollTop)} · zoom ${pianoBarWidth.toFixed(2)} px/bar`].join('\n');};paint();const timer=setInterval(paint,1000);d.addEventListener('close',()=>clearInterval(timer),{once:true});
}
function shortcuts(){if(window.vegetableStudio?.logicShell)return window.vegetableStudio.logicShell.openHelp();dialog('Disabelton',`<p>A Logic-style workstation for the Freestyle cloud DAW.</p><div class="shortcuts"><span>Start / stop playback</span><kbd>Space</kbd><span>Start / pause playback</span><kbd>Ctrl/⌘ Space</kbd><span>Playlist cursor to start</span><kbd>Home</kbd><span>Zoom focused Playlist / Piano roll</span><kbd>Page Up / Page Down</kbd><span>Playlist / Channel rack / Piano roll / Mixer</span><kbd>F5 / F6 / F7 / F9</kbd><span>Save project</span><kbd>⌘ S</kbd><span>Undo / Redo</span><kbd>⌘ Z / ⌘ ⇧ Z</kbd><span>Playlist tools (typing off)</span><kbd>P B D C E S T Z Y</kbd><span>Piano draw / paint / delete / slice / select / zoom / scrub</span><kbd>P B D C E Z Y</kbd><span>Typing keyboard on / off (Ctrl+T on Mac too: the browser reserves ⌘T for a new tab, so native FL’s ⌘T is unavailable here)</span><kbd>Ctrl T</kbd><span>Import MIDI in Piano roll</span><kbd>Ctrl/⌘ M</kbd><span>Zoom rectangle / restore view</span><kbd>Z drag / right-click</kbd><span>Select playlist clips</span><kbd>Ctrl/⌘ click or drag</kbd><span>Toggle / add playlist selection</span><kbd>Ctrl/⌘ ⇧ click or drag</kbd><span>Clone playlist clip or selected clips</span><kbd>⇧ click or drag clip body</kbd><span>Select piano notes</span><kbd>Ctrl/⌘ drag or click</kbd><span>Clone piano note or selected notes</span><kbd>⇧ click or drag note body</kbd><span>Copy / paste notes</span><kbd>⌘ C / ⌘ V</kbd><span>Quick quantize note starts</span><kbd>Shift Q</kbd><span>Quantize notes</span><kbd>Alt Q</kbd><span>Move selected notes</span><kbd>Arrow keys</kbd><span>Delete selected clips, notes or channel scores</span><kbd>Delete / Backspace (Mac Delete)</kbd><span>Toggle global snap / None</span><kbd>⇧ Backspace</kbd><span>Play instrument · native Piano layout</span><kbd>Z X C V B N M · Q W E R T Y U I</kbd><span>Zoom at cursor</span><kbd>Ctrl / ⌘ / Alt + wheel</kbd><span>Scroll horizontally</span><kbd>Shift + wheel</kbd></div><p>Playlist: P Draw, B Paint, D Delete, C Slice, E Select, S Slip, T Mute, Z Zoom, Y Playback. T currently mutes pattern clips; Y starts the arrangement from empty Playlist space. Isolated clip audition is unavailable. Turn off typing keyboard for single-letter tools. Drag clip edges to trim; right-click items for more controls.</p><button id="help-engine">Freestyle tools</button>`).querySelectorAll('button').forEach(b=>{if(b.id==='help-engine')b.onclick=()=>openCloudPanel();});}

// ── Disabelton: Logic Pro application menus (File / Edit / Track / Navigate / Record / Mix / View / Window, plus a
// Freestyle menu for cloud-only tools). Every default Freestyle feature has a Logic-named entry point here.
function selectedTrackRow(){const row=logicShell?.state?.selectedTrack;return Number.isInteger(row)&&project.cloud?.timelineLaneIds?.[row]?row:null;}
function withSelectedTrack(label,run){const row=selectedTrackRow();if(row===null)return toast(`${label}: select a track first (click its header).`);return run(row);}
/** Track ▸ Rename Track: the selected track, or the selected Mixer channel strip / bus when the Mixer has focus. */
function renameSelectedTrack(){if(activeEditor()==='mixer')return renameFocused({editor:'mixer'});return withSelectedTrack('Rename Track',row=>renamePlaylistTrack(row));}
function importAudioFile(){importedTarget=null;$('#import-audio').click();}
/** Logic's Note Pad needs a saved project text field. Studio API v1 (OpenAPI bee897e4…) has none: Project carries
 * only id, title, role, bpm, timing map, lanes and clips, and the only project write (renameProject) takes title only. */
const NOTE_PAD_UNAVAILABLE='Note Pad: Freestyle projects have no notes or lyrics field (the Studio API saves only the project title), so notes could not be stored with the project.';
/** File ▸ Export ▸ Selection as MIDI File…: the selected MIDI / pattern regions only, at their song positions. */
async function exportSelectionMidi(){
 const ids=playlistSelection.ids,regions=(project.clips||[]).filter(clip=>ids.has(clip.id)&&clip.patternId);
 if(!regions.length)return toast('Select MIDI or pattern regions to export them as a MIDI file.');
 const {encodeMidi}=await import('./midi.js');download(encodeMidi({...project,clips:regions},'song'),`${project.title||'Selection'} selection.mid`);toast(`${regions.length} region${regions.length===1?'':'s'} exported as a Standard MIDI file.`);
}
function confirmAction(title,html,ok){return new Promise(resolve=>{const d=dialog(title,`<form>${html}<button type="submit" class="primary">${esc(ok)}</button><button type="button" class="cancel">Cancel</button></form>`);let done=false;const finish=value=>{if(done)return;done=true;resolve(value);if(d.open)d.close();else d.remove();};d.addEventListener('close',()=>finish(false));d.querySelector('form').onsubmit=e=>{e.preventDefault();finish(true);};d.querySelector('.cancel').onclick=()=>finish(false);});}
const studioBody=payload=>payload?.structuredContent??payload;
/** Edit ▸ Undo History… (⌥Z): the session's ordered history that ⌘Z / ⇧⌘Z actually walk, newest applied step marked
 * (not the native engine stack from getEngineHistory, which this app's Undo does not use). */
function undoHistoryDialog(){
 const history=engine.patternHistory,state=history?.snapshot?.(),entries=state?.hasJournal&&Array.isArray(history.entries)?history.entries:[],index=entries.length?history.index:0;
 const label=entry=>{try{return history.labelFor(entry)||'Edit';}catch{return 'Edit';}};
 const rows=entries.map((entry,i)=>`<li data-history-step="${i}"${i>=index?' class="undone" style="opacity:.5"':i===index-1?' class="current" style="font-weight:600"':''}>${esc(label(entry))}</li>`).join('');
 const d=dialog('Undo History',`<p>${entries.length?'Edits recorded in this session, oldest first. The bold step is the last one applied; dimmed steps are undone (Redo brings them back).':'No undoable edits in this session yet.'}</p>${entries.length?`<ol class="logic-undo-history" style="max-height:320px;overflow:auto;margin:6px 0;padding-left:22px">${rows}</ol>`:''}<button type="button" data-history="undo"${state?.canUndo?'':' disabled'}>Undo</button><button type="button" data-history="redo"${state?.canRedo?'':' disabled'}>Redo</button>`);
 d.querySelector('[data-history="undo"]').onclick=()=>{d.close();undo();};d.querySelector('[data-history="redo"]').onclick=()=>{d.close();redo();};
 return d;
}
// File ▸ Revert to ▸ — Freestyle project saves (listProjectSaves / restoreProjectSave, confirm=true after the user agrees).
let projectSaves={projectId:null,saves:null,error:null,loading:null,at:0};
function saveLabel(save){const when=Date.parse(save?.createdAt||save?.updatedAt||'');return `${save?.name||'Saved version'}${Number.isFinite(when)?' — '+new Date(when).toLocaleString():''}`;}
/** The File menu re-reads the saves list at most every 10 s (and never while a read is in flight). */
function projectSavesFresh(){return !engine.ready||!engine.projectId||projectSaves.projectId===engine.projectId&&(!!projectSaves.loading||Date.now()-projectSaves.at<10000);}
function loadProjectSaves(){
 const projectId=engine.projectId;if(!engine.ready||!projectId)return Promise.resolve(null);
 if(projectSavesFresh())return projectSaves.loading||Promise.resolve(projectSaves.saves);
 const loading=engine.session.call('list_project_saves',{project_id:projectId}).then(payload=>{const body=studioBody(payload),saves=Array.isArray(body?.saves)?body.saves:Array.isArray(body?.data)?body.data:[];if(engine.projectId===projectId)projectSaves={projectId,saves:saves.filter(save=>typeof save?.id==='string'&&save.id),error:null,loading:null,at:Date.now()};return saves;},error=>{if(engine.projectId===projectId)projectSaves={projectId,saves:null,error:String(error?.message||error),loading:null,at:Date.now()};return null;});
 projectSaves={...(projectSaves.projectId===projectId?projectSaves:{saves:null,error:null,at:0}),projectId,loading};return loading;
}
function revertMenuItems(){
 const current=projectSaves.projectId===engine.projectId?projectSaves:null;
 if(!engine.ready||!engine.projectId)return[{label:'Open a Freestyle project first',disabled:true}];
 if(!current||!current.saves&&!current.error)return[{label:'Loading saved versions…',disabled:true}];
 if(!current.saves)return[{label:'Saved versions are unavailable',disabled:true,title:current.error||''}];
 if(!current.saves.length)return[{label:'No saved versions',disabled:true,title:'File ▸ Save (⌘S) stores a version you can revert to.'}];
 // Studio Pro Save History: each version restores, and offers its mix WAV once the render is ready.
 return current.saves.slice(0,25).map(save=>{const wav=saveDownloadState(save);return{label:saveLabel(save),submenu:[{label:'Revert to This Version…',run:()=>revertToSave(save)},{label:'Download WAV',run:()=>ablDownloadSave(save),disabled:!wav.available,title:wav.available?`Download the mix of “${save.name||'this version'}”`:wav.reason}]};});
}
async function revertToSave(save){
 const projectId=engine.projectId,trackId=engine.session.trackId,scope=JSON.stringify(fileImportScope());
 if(workspaceBusy()||rangeBusy()||engine.interacting)throw new Error('Wait for the current cloud operation to finish.');
 if(!await confirmAction('Revert to Saved Version',`<p>Revert this project to <b>${esc(saveLabel(save))}</b>?</p><p>Freestyle replaces the current project with that saved version. ⌘Z cannot undo a revert: save first (⌘S) to keep the current state as a version.</p>`,'Revert'))return null;
 if(scope!==JSON.stringify(fileImportScope())||engine.projectId!==projectId)throw new Error('The project changed. Reopen File ▸ Revert to.');
 await engine.flush();const receipt=studioBody(await engine.session.call('restore_project_save',{project_id:projectId,save_id:save.id,confirm:true}));
 clientLog('project-revert',{saveId:save.id,ok:receipt?.ok??null});projectSaves={projectId:null,saves:null,error:null,loading:null,at:0};
 // The restored project is read back from Freestyle in full; the session history starts over like Logic's.
 await engine.load(projectId,trackId);toast(`Reverted to ${saveLabel(save)}.`);return receipt;
}
// File ▸ Share ▸ — getProjectShare / updateProjectShare / inviteCollaborator / resetProjectShareLink.
function requireOpenProject(){if(!engine.ready||!engine.projectId)throw new Error('Open a Freestyle project first.');return engine.projectId;}
async function readProjectShare(projectId=requireOpenProject()){return studioBody(await engine.session.call('get_project_share',{project_id:projectId}));}
async function copyProjectLink(){
 const share=await readProjectShare(),link=share?.visibility!=='private'&&share?.shareUrl?share.shareUrl:share?.studioUrl||share?.shareUrl;if(!link)throw new Error('Freestyle returned no link for this project.');
 const note=share.visibility==='private'?'The project is private: only invited collaborators can open it.':share.visibility==='link'?'Anyone with the link can open it.':'The project is public.';
 try{await navigator.clipboard.writeText(link);toast(`Project link copied. ${note}`);}catch{const d=dialog('Copy Project Link',`<p>${esc(note)}</p><input readonly value="${esc(link)}" style="width:100%">`);d.querySelector('input').select();}
}
async function shareSettingsDialog(){
 const projectId=requireOpenProject(),share=await readProjectShare(projectId),option=(value,current)=>`<option value="${value}"${value===current?' selected':''}>${value[0].toUpperCase()+value.slice(1)}</option>`;
 const people=Array.isArray(share?.people)?share.people:[];
 const d=dialog('Share Settings',`<form><label>Who can open it <select name="visibility">${['private','link','public'].map(value=>option(value,share?.visibility)).join('')}</select></label><label>New collaborators join as <select name="default_role">${['viewer','editor'].map(value=>option(value,share?.defaultRole)).join('')}</select></label><p>${people.length} ${people.length===1?'person':'people'} on this project.</p><button type="submit" class="primary">Apply</button><button type="button" class="cancel">Cancel</button></form>`);
 d.querySelector('.cancel').onclick=()=>d.close();
 d.querySelector('form').onsubmit=event=>{event.preventDefault();const form=event.currentTarget,changes={};for(const key of ['visibility','default_role']){const value=form.elements[key].value,before=key==='visibility'?share?.visibility:share?.defaultRole;if(value!==before)changes[key]=value;}d.close();if(!Object.keys(changes).length)return;
  if(engine.projectId!==projectId)return toast('The project changed. Reopen Share Settings.');
  engine.session.call('update_project_share',{project_id:projectId,...changes}).then(payload=>{const next=studioBody(payload);toast(`Sharing updated: ${next?.visibility||changes.visibility||share?.visibility}, new people join as ${next?.defaultRole||changes.default_role||share?.defaultRole}.`);}).catch(fail);};
 return d;
}
function inviteCollaboratorDialog(){
 const projectId=requireOpenProject();
 const d=dialog('Invite Collaborator',`<form><label>Freestyle username or email <input name="user" required maxlength="120" autocomplete="off"></label><label>Role <select name="role"><option value="editor">Editor</option><option value="viewer">Viewer</option></select></label><button type="submit" class="primary">Invite</button><button type="button" class="cancel">Cancel</button></form>`);
 d.querySelector('.cancel').onclick=()=>d.close();
 d.querySelector('form').onsubmit=event=>{event.preventDefault();const form=event.currentTarget,user=form.elements.user.value.trim(),role=form.elements.role.value;if(!user)return;d.close();
  if(engine.projectId!==projectId)return toast('The project changed. Reopen Invite Collaborator.');
  engine.session.call('invite_collaborator',{project_id:projectId,user,role}).then(payload=>{const next=studioBody(payload);toast(`Invited ${user} as ${role}. ${Array.isArray(next?.people)?next.people.length:'?'} people on this project.`);}).catch(fail);};
 return d;
}
async function resetShareLink(){
 const projectId=requireOpenProject();
 if(!await confirmAction('Reset Share Link','<p>Create a new share link for this project?</p><p>The current link stops working for everyone who has it. Collaborators you invited keep their access.</p>','Reset Link'))return null;
 if(engine.projectId!==projectId)throw new Error('The project changed. Reopen Reset Share Link.');
 const share=studioBody(await engine.session.call('reset_share_link',{project_id:projectId,confirm:true}));toast('Share link reset. The previous link no longer works.');return share;
}
/** Freestyle ▸ Assistant… / Import YouTube Backing Track…: the cloud panel opened on that tool. */
function openCloudTool(tool){return openCloudPanel({tool}).catch(fail);}
/** Disabelton ⌘T / ⇧⌘T: Live inserts the track at once (no dialog), through the same guarded, history-backed
 * create as the New track dialog. MIDI = an empty LABS instrument lane (Freestyle's MIDI track needs an
 * instrument lane); without that feature the dialog opens instead. */
function insertTrackNow(kind){
 if(!engine.ready)return openCloudPanel();const instrument=kind==='instrument';
 if(instrument&&uiFeature('create_instrument')?.enabled!==true)return openTrackMenu(kind);
 const guard=()=>{if(laneCreateDialog.busy||laneCreateDialog.dialog?.isConnected||!directLevelEditable()||engine.interacting)throw new Error('Finish the current cloud edit before adding a track.');};
 guard();return insertTrackNowAfterGuard(kind,instrument,guard);
}
async function insertTrackNowAfterGuard(kind,instrument,guard){
 // No installed, creatable LABS on the project host → the dialog, which explains the gating.
 if(instrument){let rows=null;try{rows=await emptyInstrument.catalog();}catch{}const labs=Array.isArray(rows)?rows.find(row=>row?.id==='labs'):null;if(!labs||labs.creatable!==true||labs.availability?.installed===false)return openTrackMenu(kind);guard();}
 laneCreateDialog.pending=true;
 try{const receipt=await createLaneWithHistory(instrument?{type:'labs'}:{kind},{instrument});await engine.refresh();focusCreatedLane(receipt?.laneId??receipt?.lane?.id);toast(instrument?(receipt?.pluginConfirmed===false?'MIDI track inserted; its instrument is still loading.':'MIDI track inserted (empty instrument).'):'Audio track inserted.');return receipt;}
 catch(error){const message=error.message||'The track was not inserted.';toast(/^Track saved/.test(message)?message:`Not saved: ${message}`);return null;}
 finally{laneCreateDialog.pending=false;try{engine.onEditSettled();}catch{}}
}
function openTrackMenu(kind){if(!engine.ready)return openCloudPanel();if(kind==='instrument')requireUiFeature('create_instrument');return laneCreateDialog.open({kind});}
function addMenuEntries({rack=false}={}){
 const roles=types=>types.map(type=>[type[0].toUpperCase()+type.slice(1),'',()=>addChannel(type)]),audioImport=['Import audio…','',()=>{importedTarget=null;$('#import-audio').click();}];
 if(project.cloud?.rawState?.studioApi===true)return[['New audio track…','',()=>openTrackMenu('audio')],['New vocal track…','',()=>openTrackMenu('vocal')],['Add instrument…','',()=>openTrackMenu('instrument')],null,...roles(['kick','clap','hat','snare']),null,rack?['Add sample from disk…','',()=>{importedTarget=RACK_UPLOAD_TARGET;$('#import-audio').click();}]:audioImport];
 return rack?[...roles(['kick','clap','hat','snare','bass','keys','pad','piano']),audioImport]:[['New track…','',()=>$('#new-track').click()],audioImport,...roles(['kick','clap','hat','snare','bass','keys','pad','piano'])];
}
const menuItems={File:()=>{if(!projectSavesFresh())loadProjectSaves().then(()=>refreshMainMenu('File'));const noSelection=!(project.clips||[]).some(clip=>clip.patternId&&playlistSelection.ids.has(clip.id));return[['New…','',()=>{const d=dialog('New Project',`<p>Create a new Freestyle cloud project. Your current project stays in your Freestyle library.</p><button id="new-save">Save current project</button><button id="new-create" class="primary">Create empty project</button>`);d.querySelector('#new-save').onclick=saveProject;d.querySelector('#new-create').onclick=()=>{textDialog('New Project','Project title','Untitled session',title=>engine.create(title).catch(fail));d.close();};}],['Open…','⌘O',()=>openCloudPanel()],null,['Save','⌘S',saveProject],['Save As…','⇧⌘S',()=>openRangeSafeSaveAs({engine,getProject:()=>project,dialog,openLibrary:()=>openCloudPanel(),onStatus:toast})],{label:'Revert to',submenu:revertMenuItems()},null,['Project Settings…','',projectInfo],{label:'Share',submenu:[['Copy Project Link','',copyProjectLink,!engine.ready],['Share Settings…','',shareSettingsDialog,!engine.ready],['Invite Collaborator…','',inviteCollaboratorDialog,!engine.ready],null,['Reset Share Link…','',resetShareLink,!engine.ready]]},null,{label:'Import',submenu:[['Audio File…','⇧⌘I',importAudioFile],['MIDI File…','⌘I',()=>midiImport()],['Other (FL Studio / Logic project)…','',()=>$('#import-project').click()]]},{label:'Export',submenu:[{label:'Selection as MIDI File…',run:exportSelectionMidi,disabled:noSelection,title:noSelection?'Select MIDI or pattern regions first.':''},['Project as MIDI File…','',midiExport]]},{label:'Bounce',submenu:[['Project or Section…','⌘B',exportWav]]}];},Edit:()=>{const anySelected=playlistSelection.ids.size>0,recovery=[['Reload Tracks area clipboard state','',()=>inspectPlaylistClipboard().catch(fail),workspaceBusy()||!clipboardUncertain()],['Reload audio slice state','',()=>reloadAudioSlice().catch(fail),workspaceBusy()||!audioSliceEntry()],['Undo audio range','',()=>rangeEdits.undoLast(),!rangeEdits.canUndo()],['Reload audio range state','',()=>rangeEdits.reloadLast(),rangeBusy()||!rangeEdits.hasReceipt()],['Reload slice state','',reloadSliceState,sliceBusy()||!sliceRecoveryController()]];
 // ⌘Z / ⇧⌘Z cover every owner (audio slices, pattern slices, region effects); only explicit receipt recovery stays, under one submenu.
 const historyItem=(label,shortcut,run,direction)=>{const reason=historyBlockedReason(direction);return{label,shortcut,run,disabled:!historyCanStep(direction),...reason?{title:reason}:{}};};
 return[historyItem('Undo','⌘Z',undo,'undo'),historyItem('Redo','⇧⌘Z',redo,'redo'),['Undo History…','⌥Z',undoHistoryDialog],null,['Cut','⌘X',()=>playlistClipboardAction('cut'),!anySelected],['Copy','⌘C',()=>playlistClipboardAction('copy'),!anySelected],['Paste','⌘V',()=>playlistClipboardAction('paste')],['Delete','⌫',deleteSelected],null,['Select All','⌘A',()=>{playlistSelection.select(allClips().map(c=>c.id));selectedClip=playlistSelection.ids.values().next().value||null;paintPlaylistSelection();}],null,['Audio Time Range…','',()=>rangeEdits.open(),workspaceBusy()||rangeBusy()||sliceBusy()],{label:'Tool',submenu:[['Fade Tool','T A',()=>window.disabelton.selectFadeTool()]]},{label:'MIDI Transform',submenu:[{label:'Humanize…',run:()=>window.disabelton.openHumanize(),disabled:activeEditor()!=='piano',title:activeEditor()==='piano'?'':'Open the Piano Roll (P) and select notes first.'}]},{label:'Cloud Edit Recovery',submenu:recovery,disabled:recovery.every(item=>item[3]),title:'Inspect a Freestyle edit whose result was not confirmed. Nothing is repeated.'}];},Track:()=>{const row=selectedTrackRow(),laneId=row===null?null:project.cloud.timelineLaneIds[row],kind=laneId?(project.cloud?.rawProject?.lanes||[]).find(lane=>lane.id===laneId)?.kind:null,noTrack=row===null?'Select a track first (click its header).':null,duplicate=noTrack||(kind==='audio'||kind==='vocal'?null:'Freestyle duplicates audio and vocal tracks only.');
 // Logic names over the inherited track-creation entries (the Step Sequencer + menu keeps its own list).
 const logicName={'New audio track…':'New Audio Track…','New vocal track…':'New Vocal Track…','Add instrument…':'New Software Instrument Track…','New track…':'New Audio Track…'},entries=addMenuEntries().filter(item=>item&&!/^Import audio/.test(item[0])),tracks=entries.filter(item=>logicName[item[0]]).map(item=>[logicName[item[0]],item[1],item[2]]),rows=entries.filter(item=>!logicName[item[0]]);
 return[['New Tracks…','⌥⌘N',()=>$('#new-track').click()],...tracks,{label:'New Track with Duplicate Settings',shortcut:'⌘D',run:()=>withSelectedTrack('New Track with Duplicate Settings',duplicatePlaylistTrack),disabled:!!duplicate,title:duplicate||'Copies the track’s settings, effects chain and takes.'},...rows.length?[{label:'New Step Sequencer Row',submenu:rows}]:[],null,{label:'Delete Track',shortcut:'⌘⌫',run:()=>withSelectedTrack('Delete Track',deletePlaylistTrack),disabled:!!noTrack,title:noTrack||''},{label:'Rename Track',run:renameSelectedTrack,disabled:!!noTrack&&activeEditor()!=='mixer',title:activeEditor()==='mixer'?'':noTrack||''},null,['Tempo & Time Signatures…','',()=>timingDialog.open()],null,['Freestyle Instruments…','',()=>openCloudPanel()]];},
 Navigate:()=>{const known=loopStateKnown(),cycle=known&&!!engine.session.positionAt().loopEnabled;return[['Go to Beginning','↩',()=>playlistHome()],['Go Forward One Bar','.',()=>playlistCursorJump((Math.floor(playheadBeatNow()/4+1e-6)+1)*4)],['Go Back One Bar',',',()=>playlistCursorJump(Math.max(0,Math.ceil(playheadBeatNow()/4-1e-6)-1)*4)],null,{label:'Cycle',shortcut:known?'C':'Unknown',checked:known?cycle:undefined,title:known?'':'Waiting for Freestyle’s loop state',run:toggleLoopPlayback},['Set Locators…','',()=>playlistLoop.open()],['Set Locators by Regions','⌘U',()=>{const sel=allClips().filter(c=>playlistSelection.ids.has(c.id));if(!sel.length)return toast('Select regions to set the locators (⌘U).');return playlistLoop.apply({enabled:true,startBeat:Math.min(...sel.map(c=>c.start)),endBeat:Math.max(...sel.map(c=>c.start+c.length))});}]];},
 Record:()=>{const metronome=metronomeState();return[['Record','R',()=>$('#record').click()],null,{label:'Metronome Click',shortcut:metronome.actual===null?'Unknown':'K',checked:metronome.actual===null?undefined:!!metronome.actual,run:toggleMetronomeUi,disabled:!!metronome.busy||!engine.ready},['MIDI Keyboard Input',midiInputLabel(),toggleMidiInput,!midiInput?.supported]];},
 Mix:()=>{const row=selectedTrackRow(),laneId=row===null?null:project.cloud.timelineLaneIds[row],strip=id=>{if(!laneId)return{disabled:true,title:'Select a track first (click its header).'};const item=channelStripSettingEntries(laneId).find(entry=>entry.id===id);return item?{disabled:!!item.disabled,title:item.title||''}:{disabled:true,title:'Not available for this track.'};};
 return[['Show Mixer','X',()=>toggleMixer(true)],['Mixer Slots and Routing…','',()=>openSelectedMixerTools().catch(fail)],['Create Bus…','',()=>window.disabelton.createBus()],null,{label:'Copy Channel Strip Setting',run:()=>window.disabelton.copyChannelStripSetting(laneId),...strip('copy-strip')},{label:'Paste Channel Strip Setting',run:()=>window.disabelton.pasteChannelStripSetting(laneId),...strip('paste-strip')},null,['Show Track Automation','A',()=>toggleAutomationView()],['Region Automation…','',()=>openAutomation().catch(fail)]];},View:()=>{const pane=name=>!!logicShell?.state?.panes?.[name],toggle=name=>()=>logicShell?.togglePane(name),visible=id=>!!$('#'+id)&&!$('#'+id).classList.contains('hidden');
 return[{label:'Show Library',shortcut:'Y',checked:pane('library'),run:toggle('library')},{label:'Show Inspector',shortcut:'I',checked:pane('inspector'),run:toggle('inspector')},{label:'Show Mixer',shortcut:'X',checked:visible('mixer'),run:()=>toggleMixer()},{label:'Show Editor',shortcut:'E',checked:visible('piano')||visible('rack'),run:()=>$('.logic-view-buttons [data-window="piano"]')?.click()},{label:'Show Track Automation',shortcut:'A',checked:pane('automation'),run:toggle('automation')},{label:'Show Loops',shortcut:'O',checked:pane('loops'),run:toggle('loops')},{label:'Show Browsers',shortcut:'F',checked:pane('browser'),run:toggle('browser')},{label:'Show Note Pad',disabled:true,title:NOTE_PAD_UNAVAILABLE},null,['Zoom to Fit','',()=>fitPlaylistView()],null,['Use both mouse buttons in step sequencer',useBothStepButtons?'On':'Off',toggleStepMouseButtons]];},
 Window:()=>[['Show Tracks','',()=>showWindow('playlist',false)],['Open Mixer','X',()=>toggleMixer(true)],['Open Piano Roll','P',()=>showWindow('piano',false)],['Open Step Sequencer','',()=>showWindow('rack',false)],['Show Musical Typing','⌘K',()=>toggleMusicalTyping()],null,['Reset Layout','',()=>{$$('.floating-window,.playlist-window').forEach(w=>{w.classList.remove('expanded');for(const key of ['left','top','right','bottom','width','height','transform','position','margin','willChange'])w.style[key]='';});pianoMaximizedView=null;syncPianoMaximizeButton();showWindow('rack');showWindow('mixer');}]],
 Freestyle:()=>[['Freestyle Cloud Engine…','',()=>openCloudPanel()],['Assistant…','',()=>openCloudTool('mozart_ai_command')],['Import YouTube Backing Track…','',()=>openCloudTool('import_youtube_backing')],null,['Listen to Cloud-Rendered Preview','',()=>engine.listenPreview().catch(fail)],['Audio Engine Information','',()=>dialog('Audio engine',`<p>Freestyle cloud DAW · ${engine.sampleRate||48000} Hz · WebRTC monitoring</p><p>Audio generation, sequencing, mixing and rendering run on Freestyle. This browser sends controls and receives the cloud audio stream.</p>`)]],Help:()=>[['Getting started & shortcuts','',shortcuts],['Connection and interaction diagnostics','',connectionDiagnostics],['Freestyle documentation ↗','',()=>window.open('https://freestyle.audio/docs/quickstart.html','_blank')]]};
/* Disabelton: Logic Pro application menus; data-menu is the Logic menu name. */
let mainMenuOpen=null;
function openMainMenu(name){const b=$(`#main-menu [data-menu="${name}"]`);if(!b)return;const r=b.getBoundingClientRect();const bar=b.closest('.logic-titlebar')?.getBoundingClientRect();menu({clientX:r.left,clientY:bar?.height?bar.bottom:r.bottom+2},menuItems[name]());mainMenuOpen={name,node:$('#context-menu').firstElementChild};}
/** Re-render a main menu in place (e.g. File once its saved versions arrive) only while that same menu is still showing. */
function refreshMainMenu(name){const m=$('#context-menu');if(mainMenuOpen?.name===name&&!m.classList.contains('hidden')&&m.firstElementChild===mainMenuOpen.node)openMainMenu(name);}
$('#main-menu').innerHTML=Object.keys(menuItems).map(name=>`<button data-menu="${name}">${name}</button>`).join('');
// Menu bar tracking (Live/macOS): once a menu is open, moving over another title switches to it; clicking the open title closes it.
// Delegated on #main-menu because abl-shell.js re-renders the title buttons.
function mainMenuShowing(){const m=$('#context-menu');return mainMenuOpen&&!m.classList.contains('hidden')&&m.firstElementChild===mainMenuOpen.node?mainMenuOpen.name:null;}
function syncMainMenuHighlight(){const open=mainMenuShowing();for(const b of $$('#main-menu [data-menu]')){const on=b.dataset.menu===open;b.classList.toggle('menu-open',on);b.setAttribute('aria-expanded',String(on));}}
new MutationObserver(syncMainMenuHighlight).observe($('#context-menu'),{attributes:true,attributeFilter:['class'],childList:true});
// A pointer press on the title of the menu that is showing closes it on release; any other activation (keyboard, script) opens/refreshes it.
let mainMenuPressClose=null;
$('#main-menu').addEventListener('pointerdown',event=>{const b=event.target?.closest?.('[data-menu]');mainMenuPressClose=b&&mainMenuShowing()===b.dataset.menu?b.dataset.menu:null;});
$('#main-menu').addEventListener('click',event=>{const b=event.target?.closest?.('[data-menu]');if(!b)return;const close=mainMenuPressClose===b.dataset.menu&&mainMenuShowing()===b.dataset.menu;mainMenuPressClose=null;if(close){$('#context-menu').classList.add('hidden');syncMainMenuHighlight();return;}openMainMenu(b.dataset.menu);syncMainMenuHighlight();});
$('#main-menu').addEventListener('pointerover',event=>{const b=event.target?.closest?.('[data-menu]');if(!b)return;const open=mainMenuShowing();if(open&&open!==b.dataset.menu){openMainMenu(b.dataset.menu);syncMainMenuHighlight();}});
function deleteSelected(){if(activeEditor()==='playlist'&&!playlistSelection.ids.size&&selectedAutomationKey){const split=selectedAutomationKey.indexOf('|'),clipId=selectedAutomationKey.slice(0,split),targetKey=selectedAutomationKey.slice(split+1);return deleteAutomationClip(automationStore.find(clipId,targetKey));}if(activeEditor()==='piano'&&(selectedNotes.size||selectedNote)){edit(()=>{const notes=pattern().notes[channel().id]||[];pattern().notes[channel().id]=notes.filter(n=>!selectedNotes.has(n.id)&&n.id!==selectedNote);clearPianoSelection();});}else if(activeEditor()==='playlist'&&playlistSelection.ids.size){const selected=playlistSelection.ids;edit(()=>{project.clips=project.clips.filter(c=>!selected.has(c.id));project.audioClips=(project.audioClips||[]).filter(c=>!selected.has(c.id));playlistSelection.clear();selectedClip=null;});}}
// Read-only live session (monitor read grant / project_control_forbidden): one control-bar badge;
// Play/Stop/Record, MIDI note input and plug-in GUI input are disabled with the reason (abl-readonly.js).
liveReadOnly=new AblReadOnlyIndicator({monitor:engine.monitor,controls:()=>[$('#play'),$('#stop'),$('#record'),$('#abl-midi-kbd')],onChange:reason=>{clientLog('live-read-only',{readOnly:!!reason});try{paintTransportBusy();paintRecordingButton();}catch{}if(reason)toast(reason);}});
$('#play').onclick=()=>togglePlay().catch(fail);$('#stop').onclick=stop;$('#record').onclick=()=>toggleRecord().catch(fail);$('#mode').onclick=switchPlaybackMode;$('#tempo').onchange=e=>{if(project.cloud?.rawProject?.timingMap?.isConstantTempo===false){renderSummary();return toast('Edit this project’s tempo map in Options → Tempo and time signatures.');}return edit(()=>{const bpm=Math.max(10,Math.min(522,+e.target.value||128));followTempoPlacements(project,project.bpm,bpm);project.bpm=bpm;});};$('#metronome').onclick=toggleMetronomeUi;$('#pattern-select').onchange=e=>selectPattern(e.target.value);$('#add-pattern').onclick=addPattern;$('#new-picker-pattern').onclick=addPattern;$('#previous-pattern').onclick=()=>{const i=project.patterns.indexOf(pattern());selectPattern(project.patterns[(i+project.patterns.length-1)%project.patterns.length].id);};$('#undo').onclick=undo;$('#redo').onclick=redo;$('#save').onclick=()=>saveProject().catch(fail);$('#export').onclick=()=>exportWav().catch(fail);$('#help').onclick=shortcuts;$('#show-piano').onclick=()=>showWindow('piano');$('#cloud').onclick=()=>openCloudPanel().catch(fail);$('#open-cloud-footer').onclick=()=>openCloudPanel().catch(fail);$('#channel-filter').onchange=renderRack;$('#rack-fill').onclick=()=>fillRackChannel(channel().id,4);$('#add-channel').onclick=e=>menu(e,addMenuEntries({rack:true}));$('#browser-search').oninput=()=>{if(!cloudLibrary)renderBrowser();};$('#collapse-browser').onclick=()=>$('.browser').classList.toggle('collapsed');$$('[data-browser]').forEach(b=>b.onclick=()=>{browserTab=b.dataset.browser;$$('[data-browser]').forEach(x=>{x.classList.toggle('selected',x===b);if(x.getAttribute('role')==='tab')x.setAttribute('aria-selected',String(x===b));});if(cloudLibrary&&cloudLibrary.view!==cloudLibraryView)cloudLibraryView=null;renderBrowser();});
$$('button[data-tool]').forEach(b=>b.onclick=()=>{activeRackCancel?.();tool=b.dataset.tool;$('#playlist').dataset.playlistTool=tool;$$('button[data-tool]').forEach(x=>x.classList.toggle('selected',x===b));toast(`${tool[0].toUpperCase()+tool.slice(1)} tool selected`);renderPlaylist();});$('#piano-draw').onclick=()=>setPianoTool('draw');$('#piano-paint').onclick=()=>setPianoTool('paint');$('#piano-erase').onclick=()=>setPianoTool('erase');$('#piano-select').onclick=()=>setPianoTool('select');$('#piano-slice').onclick=()=>setPianoTool('slice');$('#piano-zoom').onclick=()=>setPianoTool('zoom');$('#piano-playback').onclick=()=>setPianoTool('playback');$('#piano-mute').onclick=()=>setPianoTool('mute');$('#piano-slide').onclick=()=>setPianoTool('slide');$('#piano-clear').onclick=()=>edit(()=>{pattern().notes[channel().id]=[];pattern().steps[channel().id]=Array(16).fill(false);});$('#piano-expand').onclick=togglePianoMaximize;$('#playlist-fit').onclick=()=>fitPlaylistView();/* QA round 19: the former one-click ↺ "Clear arrangement" is Edit ▸ Clear playlist… with a confirmation */$('#reset-mixer').onclick=resetChannelLevels;
for(const [id,factor]of [['playlist-zoom-out',.8],['playlist-zoom-in',1.25]])$('#'+id).onclick=()=>timelineViewport.zoomBy(factor);
/* Disabelton: Logic plays computer-keyboard notes only while Musical Typing (⌘K) is open, so the inherited typing piano starts off and its toggle is hidden. */let typingEnabled=false;const typingToggle=$('#typing-keyboard');typingToggle.className='tool-square logic-legacy';typingToggle.setAttribute('aria-pressed','false');typingToggle.title='Typing keyboard to piano (legacy)';typingToggle.textContent='⌨';typingToggle.onclick=()=>{typingEnabled=!typingEnabled;if(!typingEnabled)typingAudition.releaseAll();typingToggle.classList.toggle('lit',typingEnabled);typingToggle.setAttribute('aria-pressed',String(typingEnabled));};
mountStudioIcons();
const typingAudition=new TypingPianoAudition({getChannel:channel,onError:fail,startVoice:(current,pitch,velocity)=>{
 // Read-only session: MIDI notes (computer keyboard, Web MIDI, piano keys) are not sent.
 if(readOnlyRefusal()){$('#hint').textContent=readOnlyRefusal();return{ready:Promise.resolve(false),release(){}};}
 if(current.type==='instrument'||current.instrumentType||current.cloudRaw?.kind==='plugin')return engine.acquireInstrumentNote(current,pitch,velocity);
 // Existing sample audition is a one-shot; its API has no owned stop action.
 return{ready:engine.noteOn(current,pitch),release(){}};
}});
// FL: a hardware MIDI keyboard plays the selected Channel Rack channel.
midiInput=new WebMidiInput({getChannel:channel,startVoice:(current,pitch,velocity)=>typingAudition.startVoice(current,pitch,velocity),onError:fail,onChange:state=>paintMidiKeys(state.pitches)});
/* Web MIDI notes join an armed MIDI take (Clip View ● Rec / arm + ●); they still sound through WebMidiInput. */
{const noteOn=midiInput.noteOn.bind(midiInput),noteOff=midiInput.noteOff.bind(midiInput),key=(i,c,p)=>`webmidi:${i}:${c}:${p}`;
 midiInput.noteOn=(i,c,p,v)=>{const handled=noteOn(i,c,p,v);try{window.ablClipView?.captureExternal?.(true,p,Number(v)/127,key(i,c,p));}catch{}return handled;};
 midiInput.noteOff=(i,c,p)=>{const handled=noteOff(i,c,p);try{window.ablClipView?.captureExternal?.(false,p,0,key(i,c,p));}catch{}return handled;};}
// ---- Logic Editors pane (Piano Roll | Step Sequencer), Musical Typing (⌘K), Step Sequencer header ----
// var: showWindow() may run syncEditorPane() before this line during startup.
var editorPaneKind=$('#piano').classList.contains('hidden')?'step':'piano';
function editorPaneVisible(){return ['piano','rack'].some(id=>!$('#'+id).classList.contains('hidden'));}
/** Logic shows one editor tab at a time in the bottom pane: showing one hides the other. */
// The tab a just-shown editor replaced: hiding that editor with its window toggle returns to it
// (e.g. Step Sequencer → Piano Roll → toggle off → Step Sequencer); E / closeEditorPane closes the pane.
var editorPaneDisplaced=null;
function syncEditorPane(changedId){
 const win=changedId&&$('#'+changedId),other=changedId&&$('#'+(changedId==='piano'?'rack':'piano'));
 if(win&&!win.classList.contains('hidden')){if(!other.classList.contains('hidden')){other.classList.add('hidden');$$(`[data-window="${other.id}"]`).forEach(b=>b.classList.remove('lit'));editorPaneDisplaced=other.id;}else if(editorPaneDisplaced===changedId)editorPaneDisplaced=null;editorPaneKind=editorKindForWindow(changedId);document.dispatchEvent(new CustomEvent('disabelton-editor-shown',{detail:{kind:editorPaneKind}}));}
 else if(win&&editorPaneDisplaced===other.id){editorPaneDisplaced=null;other.classList.remove('hidden');windows.raise(other);$$(`[data-window="${other.id}"]`).forEach(b=>b.classList.add('lit'));editorPaneKind=editorKindForWindow(other.id);if(other.id==='rack')renderRack();else renderPiano();}
 // Logic: the Mixer (X) and the editors share the bottom pane; showing an editor closes the Mixer.
 if(editorPaneVisible())closeMixerDock();
 document.body.classList.toggle('editors-open',editorPaneVisible());document.body.dataset.editor=editorPaneVisible()?editorPaneKind:'';
 for(const tabs of $$('.logic-editor-tabs'))setMarkupIfChanged(tabs,editorTabsMarkup(editorPaneKind));
}
function openEditorPane(kind='piano'){const id=editorWindowId(kind);if(!id)return false;showWindow(id);if(id==='rack')renderRack();return true;}
function closeEditorPane(){activePianoCancel?.();activeRackCancel?.();editorPaneDisplaced=null;for(const id of ['piano','rack']){$('#'+id).classList.add('hidden');$$(`[data-window="${id}"]`).forEach(b=>b.classList.remove('lit'));}syncEditorPane(null);return true;}
function toggleEditorPane(){return editorPaneVisible()?closeEditorPane():openEditorPane(editorPaneKind);}
// The docked Mixer shares the bottom slot (X swaps): body.mixer-open hides the Editors and closing the
// Mixer brings back the editor it covered. Showing an editor announces itself so the Mixer can step aside.
var editorsCoveredByMixer=null,mixerWasOpen=document.body.classList.contains('mixer-open');
new MutationObserver(()=>{const mixer=document.body.classList.contains('mixer-open');if(mixer===mixerWasOpen)return;mixerWasOpen=mixer;// act on Mixer open/close transitions only
 if(mixer&&editorPaneVisible()){editorsCoveredByMixer=editorPaneKind;closeEditorPane();}
 else if(!mixer&&editorsCoveredByMixer){const kind=editorsCoveredByMixer;editorsCoveredByMixer=null;openEditorPane(kind);}
}).observe(document.body,{attributes:true,attributeFilter:['class']});
window.addEventListener('disabelton-bottom-pane',e=>{if(e.detail?.owner!=='editors')editorsCoveredByMixer=null;});
document.addEventListener('disabelton-editor-shown',()=>{editorsCoveredByMixer=null;if(document.body.classList.contains('mixer-open'))window.dispatchEvent(new CustomEvent('disabelton-bottom-pane',{detail:{owner:'editors'}}));});
document.addEventListener('click',e=>{const tab=e.target.closest?.('[data-editor-tab]');if(tab){e.preventDefault();openEditorPane(tab.dataset.editorTab);}});
syncEditorPane(editorPaneVisible()?(editorPaneKind==='piano'?'piano':'rack'):null);
// Editors pane height: drag the top edge (Logic's divider). Persisted per browser only.
// v2 key: heights saved before the Logic ~40 % default are ignored.
{const root=document.documentElement,heightKey='disabelton-editor-height-v2';let saved=0;try{saved=Number(localStorage.getItem(heightKey))||0;}catch{}
 const apply=height=>{const value=clampEditorHeight(height,{viewport:innerHeight||900});root.style.setProperty('--logic-editor-height',`${value}px`);return value;};apply(saved||defaultEditorHeight(innerHeight||900));
 for(const handle of $$('.logic-editor-resize'))handle.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();const pane=handle.closest('.logic-editor-pane'),startY=e.clientY,startHeight=pane?.getBoundingClientRect().height||EDITOR_HEIGHT.default;let last=startHeight;try{handle.setPointerCapture(e.pointerId);}catch{}
  const move=next=>{if(next.pointerId!==e.pointerId)return;last=apply(startHeight+(startY-next.clientY));},up=next=>{if(next.pointerId!==e.pointerId)return;handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',up);handle.removeEventListener('pointercancel',up);try{localStorage.setItem(heightKey,String(last));}catch{}pianoNavigator?.refresh();};
  handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',up);handle.addEventListener('pointercancel',up);});}
// Piano Roll header and local inspector.
$('#piano-tool-left').onclick=e=>pianoToolMenu(e,false);$('#piano-tool-command').onclick=e=>pianoToolMenu(e,true);syncPianoToolMenus();
for(const [id,kind]of [['piano-menu-edit','edit'],['piano-menu-functions','functions'],['piano-menu-view','view']])$('#'+id).onclick=e=>pianoLocalMenu(e,kind);
$('#piano-midi-in').onclick=()=>toggleMidiInput().finally(()=>{const on=midiInput?.state==='on';$('#piano-midi-in').classList.toggle('lit',on);$('#piano-midi-in').setAttribute('aria-pressed',String(on));});
$('#piano-midi-out').onclick=()=>{togglePianoPreviewNotes();$('#piano-midi-out').classList.toggle('lit',pianoPreviewNotes);$('#piano-midi-out').setAttribute('aria-pressed',String(pianoPreviewNotes));};
$('#piano-quantize-grid').onchange=e=>{pianoQuantize.grid=e.target.value;};$('#piano-quantize-apply').onclick=()=>quantizePianoSelection();
for(const key of ['strength','swing'])$(`#piano-quantize-${key}`).oninput=e=>{pianoQuantize[key]=Number(e.target.value);$(`#piano-quantize-${key}-value`).textContent=e.target.value;};
$('#piano-scale-root').onchange=e=>{pianoQuantize.scaleRoot=e.target.value;syncPianoInspector();};$('#piano-scale-type').onchange=e=>{pianoQuantize.scale=e.target.value;};$('#piano-scale-apply').onclick=()=>scaleQuantizePianoSelection();
$('#piano-velocity-slider').oninput=e=>{const midi=Number(e.target.value);$('#piano-velocity-value').textContent=String(midi);for(const node of $$('#piano .piano-note[data-note]'))if(selectedNotes.has(node.dataset.note))node.style.setProperty('--note-color',logicVelocityColor(midi/127));};
$('#piano-velocity-slider').onchange=e=>{if(!setSelectedNoteVelocity(Number(e.target.value)))renderPiano();};
$('#piano-hzoom').oninput=e=>{const value=Number(e.target.value);if(value>0&&!engine.interacting)pianoViewport.zoomBy(value/pianoBarWidth);};
$('#piano-vzoom').oninput=e=>{const value=Number(e.target.value);if(value>0&&!engine.interacting)applyPianoView({...pianoView(),rowHeight:value});};
// Step Sequencer header: pattern browser (pick, create, drag into a track), length and rate.
function renderStepPatternList(){
 const list=$('#step-pattern-list');if(!list||list.hidden)return;
 list.innerHTML=project.patterns.filter(p=>p.id!=='empty').map((p,i)=>`<div class="logic-pattern-item${p.id===project.selectedPattern?' selected':''}" role="option" draggable="true" data-step-pattern="${esc(p.id)}" aria-selected="${p.id===project.selectedPattern}" style="--clip-color:${colors[i%colors.length]}" title="${esc(p.name)} · click to edit, drag into a track to place it">${patternSvg(p)}<span>${esc(p.name)}</span></div>`).join('')+'<button type="button" class="logic-pattern-new" title="Create an empty pattern">＋ New Pattern</button><button type="button" class="logic-pattern-rename" title="Rename the current pattern">Rename…</button><button type="button" class="logic-pattern-duplicate" title="Duplicate the current pattern">Duplicate</button>';
 for(const item of list.querySelectorAll('[data-step-pattern]')){const id=item.dataset.stepPattern;item.onclick=()=>selectPattern(id);item.ondblclick=()=>renamePattern(id);item.ondragstart=e=>{e.dataTransfer.setData('application/vegetable-pattern',id);e.dataTransfer.effectAllowed='copy';};item.oncontextmenu=e=>{e.preventDefault();patternMenu(e,id);};}
 list.querySelector('.logic-pattern-new').onclick=()=>addPattern();
 list.querySelector('.logic-pattern-rename').onclick=()=>renamePattern(pattern().id);
 list.querySelector('.logic-pattern-duplicate').onclick=()=>duplicatePattern(pattern().id);
}
function syncStepSequencerHeader(){
 const p=pattern(),button=$('#step-pattern-browser');if(!button||!p)return;button.textContent=p.name||'Pattern';
 const steps=Math.ceil(patternLengthBeats(p)*4),lengthButton=$('#rack-steps');if(lengthButton)lengthButton.title=`Pattern length: ${steps} steps (${steps/16} bar${steps===16?'':'s'})`;renderStepPatternList();
}
/** Logic's Pattern Browser drawer: project patterns (click loads one into the Step Sequencer), New Pattern, drag into a track. */
function toggleStepPatternBrowser(force){const list=$('#step-pattern-list');list.hidden=typeof force==='boolean'?!force:!list.hidden;for(const id of ['step-pattern-browser','rack-menu'])$('#'+id)?.setAttribute('aria-expanded',String(!list.hidden));$('#rack-menu')?.classList.toggle('lit',!list.hidden);$('#rack').classList.toggle('pattern-browser-open',!list.hidden);renderStepPatternList();return !list.hidden;}
$('#step-pattern-browser').onclick=()=>toggleStepPatternBrowser();
$('#step-new-pattern').onclick=()=>addPattern();
$('#rack-steps').onclick=e=>{const p=pattern(),bars=patternLengthBeats(p)/4,bounds=e.currentTarget.getBoundingClientRect();menu({clientX:bounds.left,clientY:bounds.bottom},[...[1,2,3,4,8,16].map(value=>({label:`${value*16} Steps`,shortcut:`${value} bar${value===1?'':'s'}`,checked:bars===value,run:()=>{if(patternLengthBeats(pattern())/4!==value)edit(()=>setPatternLengthBars(pattern(),value));}})),null,{label:'Other Length…',run:()=>patternLengthDialog(pattern())}]);};
$('#step-rate').onchange=e=>{e.target.value='0.25';toast('Freestyle step patterns use 1/16 steps.');};
/** Logic Step Sequencer row solo: this row plays, the pattern's other rows are muted (one undo step). */
function soloStepRow(id){
 const rows=rackDisplayRows().map(row=>row.channel).filter(Boolean);if(rows.length<2)return false;const soloed=rows.every(c=>c.id===id?!c.mute:c.mute);
 return edit(()=>{for(const c of rows)c.mute=soloed?false:c.id!==id;});
}
function decorateStepSequencerRows(){
 const rows=rackDisplayRows().map(row=>row.channel).filter(Boolean),solo=rows.length>1?rows.find(c=>!c.mute&&rows.every(other=>other===c||other.mute)):null;
 $$('#rack .rack-channel').forEach((row,index)=>{row.style.setProperty('--row-color',colors[index%colors.length]);const c=row.classList.contains('rack-missing')?null:project.channels.find(item=>item.id===row.dataset.channel);
  // Rows not used in this pattern keep the same (disabled) M S columns so every row's pads line up.
  if(!c){const enable=row.querySelector('.channel-enable');if(enable){enable.textContent='M';enable.title='Use this row in the pattern to mute it';}if(!row.querySelector('.step-solo')){const spacer=document.createElement('button');spacer.type='button';spacer.className='step-solo';spacer.textContent='S';spacer.disabled=true;spacer.title='Use this row in the pattern to solo it';(enable||row.querySelector('.channel-name'))?.after?.(spacer);}return;}
  const enable=row.querySelector('.channel-enable');if(enable){enable.textContent='M';enable.setAttribute('role','button');enable.setAttribute('aria-pressed',String(!!c.mute));enable.title=`Mute ${c.name}`;}
  let button=row.querySelector('.step-solo');if(!button){button=document.createElement('button');button.type='button';button.className='step-solo';button.textContent='S';(enable||row.firstChild)?.after?.(button);}
  button.classList.toggle('on',solo===c);button.setAttribute('aria-pressed',String(solo===c));button.title=`Solo ${c.name}`;button.onclick=()=>soloStepRow(c.id);
 });
}
function stepContextMenu(e,id,step){
 e.preventDefault();if(rackStepGesture.active||activeRackCancel)return;const p=pattern(),before=p.steps[id]||Array(Math.max(16,Math.ceil(patternLengthBeats(p)*4))).fill(false),on=!!before[step],editable=rackStepEditable();
 menu(e,[{label:on?'Turn Step Off':'Turn Step On',disabled:!editable,run:()=>edit(()=>{const steps=before.slice();steps[step]=!on;pattern().steps[id]=steps;})},{label:'Clear Row',disabled:!editable||!before.some(Boolean),run:()=>edit(()=>{pattern().steps[id]=before.map(()=>false);})},{label:'Fill Every 4 Steps',disabled:!editable,run:()=>$('#rack-fill').click()},null,{label:'Edit Velocity',run:()=>toggleRackGraph()},{label:'Open in Piano Roll',run:()=>{selectedChannel=id;openEditorPane('piano');}}]);
}
// Musical Typing (⌘K): audition only, through the same owned-voice path as the typing piano.
const musicalTyping=new LogicMusicalTyping({onChange:()=>paintMusicalTyping()});
const musicalTypingAudition=new TypingPianoAudition({getChannel:channel,onError:fail,startVoice:(current,pitch,velocity)=>typingAudition.startVoice(current,pitch,velocity),pitchFor:event=>musicalTyping.pitchFor(event),velocityFor:()=>musicalTyping.velocityFor(),keyFor:typingCode});
const musicalTypingOpen=()=>!$('#musical-typing').classList.contains('hidden');
function paintMusicalTyping(){const body=$('#musical-typing-body');if(body&&musicalTypingOpen())body.innerHTML=musicalTypingMarkup(musicalTyping,new Set(musicalTypingAudition.held.keys()));}
function toggleMusicalTyping(force){const win=$('#musical-typing'),open=typeof force==='boolean'?force:!musicalTypingOpen();win.classList.toggle('hidden',!open);if(!open)musicalTypingAudition.releaseAll();paintMusicalTyping();return open;}
$('#musical-typing-close').onclick=()=>toggleMusicalTyping(false);
$('#musical-typing-body').addEventListener('pointerdown',e=>{const key=e.target.closest?.('.mt-key');if(!key||e.button!==0)return;e.preventDefault();let voice=null;try{voice=typingAudition.startVoice(channel(),Number(key.dataset.pitch),musicalTyping.velocityFor());}catch(error){fail(error);return;}key.classList.add('down');const release=()=>{key.classList.remove('down');try{voice?.release?.();}catch(error){fail(error);}window.removeEventListener('pointerup',release);window.removeEventListener('pointercancel',release);};window.addEventListener('pointerup',release);window.addEventListener('pointercancel',release);Promise.resolve(voice?.ready).catch(fail);});
// While Musical Typing is open its keys win over editor shortcuts (Logic); ⌘/⌥/⌃ chords and Space still pass.
// Window capture, registered before the Logic key map (also window capture), so these keys reach it first.
window.addEventListener('keydown',e=>{if(!musicalTypingOpen()||e.target.closest?.('input,select,textarea,[contenteditable=true]')||shortcutDialogOpen(e))return;
 if(musicalTyping.owns(e)&&musicalTyping.pitchFor(e)===null){if(!e.repeat)musicalTyping.control(e);e.preventDefault();e.stopImmediatePropagation();return;}
 if(musicalTyping.pitchFor(e)!==null){musicalTypingAudition.keyDown(e);/* keyDown first: a prevented event is not a playable key */e.preventDefault();e.stopImmediatePropagation();paintMusicalTyping();}},true);
window.addEventListener('keyup',e=>{if(musicalTypingAudition.keyUp(e)){e.stopImmediatePropagation();paintMusicalTyping();}},true);
window.addEventListener('blur',()=>{musicalTypingAudition.releaseAll();paintMusicalTyping();});
/** Logic Tracks-area context menu: "Create Pattern Region" / "Create MIDI Region" on empty track space.
 * ONE gesture = ONE history step (Logic): createPattern + createPatternPlacement are saved as one external
 * step; ⌘Z deletes the region and its (still empty) pattern, ⇧⌘Z restores the pattern (same ID, restorePattern)
 * and places the region again. Every write is guarded by a fresh read and never overwrites newer data.
 * kind: 'pattern' | 'midi'. Resolves {patternId, clipId} (UI ids) or null when refused. */
let regionCreatePending=false;
const regionKey=()=>globalThis.crypto?.randomUUID?.()||`region-create-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const regionBody=result=>result?.structuredContent?.response??result?.structuredContent??result?.response??result;
const regionError=(message,fields={})=>Object.assign(new Error(message),fields);
async function createPatternRegionAt(trackIndex,beat,kind='pattern'){
 if(!Number.isInteger(trackIndex)||trackIndex<0||!Number.isFinite(beat)||beat<0||!['pattern','midi'].includes(kind)){toast('Choose a place on a track to create the region.');return null;}
 if(regionCreatePending||!engine.ready||engine.loading||engine.applying||engine.interacting||activePlaylistCancel||activePianoCancel||activeRackCancel||workspaceBusy()||rangeBusy()||sliceBusy()||engine.patternHistory?.externalPending){toast('Finish the current edit before creating a region.');return null;}
 const laneId=project.cloud?.timelineLaneIds?.[trackIndex];if(!laneId){toast('Create a track there first, then add the region.');return null;}
 const snap=Number($('#snap').value)||0,start=snap>0?Math.floor(beat/snap+1e-9)*snap:beat,label=kind==='midi'?'Create MIDI Region':'Create Pattern Region',history=engine.patternHistory;regionCreatePending=true;let pending=null;
 try{
  await engine.flush();const scope=fileImportScope(),options=extra=>({refresh:false,expectedContext:{projectId:scope.projectId,trackId:scope.trackId,contextVersion:engine.session.contextVersion||0},idempotencyKey:regionKey(),...extra});
  // Logic names a new region after its track ("Keys"); " 2", " 3"… only when a pattern already has that name.
  const patterns=project.patterns.filter(value=>value.id!=='empty'),base=String(project.trackNames?.[trackIndex]||'').trim()||(kind==='midi'?'MIDI Region':'Pattern Region'),taken=new Set(patterns.map(value=>value.name));
  let name=base;for(let n=2;taken.has(name);n++)name=`${base} ${n}`;
  const local={id:'local-'+uid(),name,bars:1,steps:{},notes:{}},model={...project,patterns:[...patterns,local]};
  const patternDto=serializeCloudPattern(local,model),localClip={id:'local-'+uid(),patternId:local.id,track:trackIndex,start,length:patternLengthBeats(local)};
  let placementId=null,patternId=null;
  const placeRegion=async()=>{const raw=await savedRaw(),placement=serializeCloudPlacement(localClip,model,{[local.id]:patternId});placement.laneId=laneId;
   const made=regionBody(await engine.session.action('create_pattern_placement',{placement},options({ifMatch:JSON.stringify(raw.timelineRevision)})));
   const id=[made?.placement?.id,made?.placementId,made?.placement_id,made?.id].find(value=>typeof value==='string'&&value);if(!id)throw regionError('Freestyle placed the region without returning its ID. Reload the project to inspect it.',{operationUncertain:true});placementId=id;};
  const confirm=async present=>{const raw=await savedRaw(),hasPattern=raw.patterns.some(row=>row.id===patternId),hasPlacement=raw.placements.some(row=>row.id===placementId&&row.patternId===patternId);if(present?!(hasPattern&&hasPlacement):hasPattern||raw.placements.some(row=>row.id===placementId))throw regionError(`Freestyle has not confirmed the ${present?'new':'removed'} region.`,{operationUncertain:true});return raw;};
  pending=history.beginExternalStep({kind:'pattern_region_create',label});
  const made=regionBody(await engine.session.action('create_pattern',{pattern:patternDto},options()));patternId=made?.pattern?.id||made?.patternId||made?.pattern_id||made?.id;if(!patternId)throw regionError('Freestyle created a pattern without returning its ID. Reload the project to inspect it.',{operationUncertain:true});
  await placeRegion();await confirm(true);
  // Undo: only the untouched empty pattern and its one region are removed; anything newer refuses (nothing sent).
  const undo=async()=>{const raw=await savedRaw(),saved=raw.patterns.find(row=>row.id===patternId),placement=raw.placements.find(row=>row.id===placementId);
   if(!saved||!placement||placement.laneId!==laneId||(saved.pattern?.events||[]).length||raw.placements.some(row=>row.patternId===patternId&&row.id!==placementId))throw regionError('That region or its pattern changed after it was created. Undo will not overwrite newer data.',{dispatched:false});
   await engine.session.action('delete_pattern_placement',{placement_id:placementId},options({confirmedDestructive:true,ifMatch:JSON.stringify(raw.timelineRevision)}));
   await engine.session.action('delete_pattern',{pattern_id:patternId},options({confirmedDestructive:true}));await confirm(false);renderAll();return{patternId,placementId};};
  const redo=async()=>{const raw=await savedRaw();if(raw.patterns.some(row=>row.id===patternId)||raw.placements.some(row=>row.id===placementId))throw regionError('The region already exists. Redo will not duplicate it.',{dispatched:false});
   await engine.session.action('restore_pattern',{pattern_id:patternId},options());await placeRegion();await confirm(true);renderAll();return{patternId,placementId};};
  history.finishExternalStep(pending,{undo,redo,detail:{patternId,placementId,laneId,start}});pending=null;
  const uiPattern=project.patterns.find(row=>row.cloudId===patternId||row.id===patternId),uiClip=project.clips.find(row=>row.cloudId===placementId||row.id===placementId);
  if(uiPattern)selectPattern(uiPattern.id);else renderAll();toast(`${label.replace('Create ','')} created.`);
  return{patternId:uiPattern?.id??patternId,clipId:uiClip?.id??placementId};
 }catch(error){if(pending)history.failExternalStep(pending,error);fail(error);return null;}finally{regionCreatePending=false;}
}
window.disabelton=Object.assign(window.disabelton||{},{createPatternRegionAt});
registerEditorsApi({open:openEditorPane,toggle:toggleEditorPane,close:closeEditorPane,toggleMusicalTyping:()=>toggleMusicalTyping(),quantize:quantizePianoSelection,setTool:tool=>{if(activeEditor()==='rack')return false;/* Logic's Tool menu id 'solo' is the Piano Roll's Solo (audition/scrub) tool */const id=tool==='solo'?'playback':tool;if(!logicPianoTool(id))return false;setPianoTool(id);return true;},active:()=>editorPaneVisible()?editorPaneKind:null});
function midiInputLabel(){const state=midiInput?.state;return state==='on'?`On${midiInput.inputs.size?` · ${midiInput.inputNames().join(', ')}`:' · no device'}`:state==='requesting'?'Requesting…':state==='denied'?'Blocked':state==='unsupported'?'Unsupported':state==='error'?'Error':'Off';}
function toggleMidiInput(){return midiInput.toggle().then(state=>toast(state==='on'?`MIDI keyboard input on${midiInput.inputs.size?`: ${midiInput.inputNames().join(', ')}`:' (connect a device)'}`:state==='off'?'MIDI keyboard input off':midiInput.error||`MIDI keyboard input ${state}`));}
{let wire=engine.monitor.generation;const reset=()=>{if(engine.monitor.generation!==wire){wire=engine.monitor.generation;midiInput.releaseAll();}};for(const type of ['state','connected'])engine.monitor.addEventListener?.(type,reset);}
const coreShortcutHandlers={
 // Disabelton: FL's F5/F6/F7/F9 window keys are not Logic keys (X Mixer, E Editors, P Piano Roll live in logic-keys.js).
 // Disabelton: FL's F2 (rename) and F4 (next empty pattern) are not Logic keys. Rename lives in Track ▸ Rename Track
 // and the Pattern Browser; New Pattern in the Pattern Browser.
 'playlist-home':playlistHome,
 'quick-quantize-starts':quickQuantizePianoStarts,
 'zoom-editor':zoomEditorPage,
 'transport-start-stop':()=>togglePlay({stopInsteadOfPause:true}).catch(fail),
 'transport-start-pause':()=>togglePlay().catch(fail),undo:()=>undo(),redo:()=>redo(),
 save:()=>saveProject().catch(fail),'save-as':()=>Promise.resolve().then(()=>openRangeSafeSaveAs({engine,getProject:()=>project,dialog,openLibrary:()=>openCloudPanel(),onStatus:toast})).catch(fail),open:()=>openCloudPanel().catch(fail),
 'toggle-snap':()=>toggleSnap(),'toggle-typing':()=>typingToggle.click(),'toggle-metronome':()=>toggleMetronomeUi(),'midi-import':()=>midiImport().catch(fail),
 'set-tool':action=>action.editor==='piano'?setPianoTool(action.tool):$(`[data-tool="${action.tool}"]`)?.click(),
 deselect:action=>{if(action.editor==='piano'){clearPianoSelection();renderPiano();}else{playlistSelection.clear();selectedClip=null;paintPlaylistSelection();}},
 'delete-selection':action=>action.editor==='rack'?rackClipboardAction('delete'):deleteSelected(),
 copy:action=>action.editor==='playlist'?playlistClipboardAction('copy'):action.editor==='piano'?copyPianoNotes():rackClipboardAction('copy'),
 cut:action=>action.editor==='playlist'?playlistClipboardAction('cut'):action.editor==='piano'?cutPianoNotes():rackClipboardAction('cut'),
 paste:action=>action.editor==='playlist'?playlistClipboardAction('paste'):action.editor==='piano'?pastePianoNotes():rackClipboardAction('paste'),
 duplicate:action=>action.editor==='playlist'?queuePlaylistDuplicate():duplicatePianoNotes()
};
document.addEventListener('keydown',e=>{if(playlistKeyboard.keyDown(e))return;if(studioShortcutBlocked(e,{dialogOpen:shortcutDialogOpen(e)}))return;if(handleStudioShortcut(e,{editor:activeEditor(),typingEnabled,dialogOpen:false,availableTools:{playlist:['draw','paint','erase','slice','select','slip','mute','zoom','playback']}},coreShortcutHandlers))return;if(e.defaultPrevented||e.target.closest('input,select,textarea,[contenteditable=true]')||shortcutDialogOpen(e))return;const meta=e.metaKey||e.ctrlKey,rackCommand=rackClipboardCommand(e,{rackFocused:activeEditor()==='rack',dialogOpen:shortcutDialogOpen(e)});if(rackCommand){e.preventDefault();rackClipboardAction(rackCommand);return;}const rackRotate=rackRotateCommand(e,{rackFocused:activeEditor()==='rack',dialogOpen:shortcutDialogOpen(e)});if(rackRotate){e.preventDefault();rotateRackChannels(rackStepChannelIds(rackStepChannelIds(null).length?null:channel().id),rackRotate);return;}if(meta&&e.key.toLowerCase()==='a'&&activeEditor()==='rack'){e.preventDefault();rackSelector.selectAll();return;}if(meta&&e.key.toLowerCase()==='k'&&activeEditor()==='rack'){e.preventDefault();if(!e.repeat)toggleRackGraph();return;}if(meta&&e.key.toLowerCase()==='a'&&activeEditor()==='playlist'){e.preventDefault();activePlaylistCancel?.();playlistSelection.select(allClips().map(c=>c.id));selectedClip=playlistSelection.ids.values().next().value||null;paintPlaylistSelection();return;}if(activeEditor()==='piano'){if(isPianoGhostToggle(e)){e.preventDefault();togglePianoGhosts();return;}if(!meta&&!e.altKey&&!e.shiftKey&&e.key.toLowerCase()==='q'){/* Logic Q: Time Quantize the selection */e.preventDefault();if(!e.repeat)quantizePianoSelection();return;}if(meta&&['u','g'].includes(e.key.toLowerCase())){e.preventDefault();if(!e.repeat)restructurePianoNotes(e.key.toLowerCase()==='u'?'chop':'glue');return;}if(meta&&e.key.toLowerCase()==='b'){e.preventDefault();if(!e.repeat)duplicatePianoNotes();return;}if(meta&&e.key.toLowerCase()==='a'){e.preventDefault();clearPianoSelection();(pattern().notes[channel().id]||[]).forEach(n=>selectedNotes.add(n.id));renderPiano();return;}if(meta&&e.key.toLowerCase()==='x'){e.preventDefault();if(!e.repeat)cutPianoNotes();return;}if(meta&&e.key.toLowerCase()==='c'){e.preventDefault();copyPianoNotes();return;}if(meta&&e.key.toLowerCase()==='v'){e.preventDefault();pastePianoNotes();return;}if(e.altKey&&e.key.toLowerCase()==='q'){e.preventDefault();quantizePianoDialog();return;}if((selectedNotes.size||e.shiftKey||meta&&['ArrowUp','ArrowDown'].includes(e.key))&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();engine.interacting=true;const step=e.altKey?pianoMinimumNote(pattern()):(pianoSnap()||pianoMinimumNote(pattern())),deltaStart=e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0,deltaPitch=e.key==='ArrowUp'?(meta?12:1):e.key==='ArrowDown'?(meta?-12:-1):0;transformPianoNotes(notes=>movePianoGesture(notes,{deltaBeats:deltaStart,deltaPitch,snapBeats:0}));return;}}if(meta&&e.key.toLowerCase()==='s'){e.preventDefault();if(e.shiftKey)Promise.resolve().then(()=>openRangeSafeSaveAs({engine,getProject:()=>project,dialog,openLibrary:()=>openCloudPanel(),onStatus:toast})).catch(fail);else saveProject().catch(fail);return;}if(meta&&e.key.toLowerCase()==='o'){e.preventDefault();openCloudPanel().catch(fail);return;}if(meta&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();return;}if(e.key==='Delete'&&!meta&&!e.altKey&&!e.shiftKey){e.preventDefault();if(!e.repeat)deleteSelected();return;}if(e.key==='Escape'){if(activePlaylistCancel){activePlaylistCancel();return;}$('#context-menu').classList.add('hidden');playlistSelection.clear();selectedClip=null;paintPlaylistSelection();return;}if(meta||e.altKey)return;if(!typingEnabled&&activeEditor()==='piano'&&({p:'draw',b:'paint',d:'erase'})[e.key.toLowerCase()]){e.preventDefault();setPianoTool(({p:'draw',b:'paint',d:'erase'})[e.key.toLowerCase()]);return;}if(!typingEnabled&&activeEditor()==='playlist'&&({p:'draw',b:'paint',d:'erase',c:'slice'})[e.key]){const selected=({p:'draw',b:'paint',d:'erase',c:'slice'})[e.key];$(`[data-tool="${selected}"]`).click();return;}if(typingEnabled&&typingAudition.keyDown(e))e.preventDefault();});
// FL: show the resize cursor over each clip's ~8 px edge zones.
{let hovered=null;const clear=()=>{hovered?.removeAttribute('data-trim-edge');hovered=null;};$('#track-lanes').addEventListener('pointermove',event=>{if(event.buttons)return;const el=event.target?.closest?.('.clip[data-clip]'),edge=el&&!PLAYLIST_NO_TRIM_TOOLS.has(tool)?clipEdgeAt(event,el):null;if(hovered&&hovered!==el)clear();if(!el||!edge){el?.removeAttribute('data-trim-edge');if(hovered===el)hovered=null;return;}if(el.dataset.trimEdge!==edge)el.dataset.trimEdge=edge;hovered=el;});$('#track-lanes').addEventListener('pointerleave',clear);}
// FL: every Playlist drag source shares one hotspot (drag image left edge at the pointer), so the start cell is the cell under the pointer.
installPlaylistDragHotspot(document,{mimes:['application/vegetable-pattern',LIBRARY_SOUND_MIME],describe:(element,mime)=>element?.closest?.('#pattern-picker')?'pattern-picker':element?.closest?.('[data-library^="pattern:"]')?'browser-pattern':element?.closest?.('#rack')?'rack-channel':mime===LIBRARY_SOUND_MIME?'browser-sample':'other'});
// FL: Space stays transport even after a toolbar button (PAT/SONG, windows, tools) was clicked.
installTransportKeyGuard(document);
document.addEventListener('mouseover',e=>{const el=e.target.closest('[title]');if(el){$('#hint').textContent=el.title;automationReadouts.hint=el.closest('.logic-auto-point,.logic-auto-segment,.abl-auto-overlay')?el.title:null;}});
/** QA r14: a breakpoint's hover title ("0.0 dB") and the drag readout are transient: they leave the status bar once the
 * edit commits (the left field kept a stale "0.0 dB" after an automation edit). Only the readout text itself is cleared. */
var automationReadouts={hint:null,status:null};
function automationStatus(text){toast(text);automationReadouts.status=$('#status-message').textContent;}
function clearAutomationReadouts(){const hint=$('#hint'),status=$('#status-message');if(automationReadouts.hint!=null&&hint?.textContent===automationReadouts.hint)hint.textContent='';if(automationReadouts.status!=null&&status?.textContent===automationReadouts.status)status.textContent='';automationReadouts.hint=null;automationReadouts.status=null;}
window.addEventListener('vegetable-cloud-status',e=>{$('#cloud-led').classList.toggle('connected',!!e.detail.connected);});
// FL meter ballistics (instant attack, dB-rate release, peak hold): a frame loop runs
// while any meter is above zero; stopped transport releases every meter to zero.
let meterFrame=null,meterStaleTimer=null,meterBallisticsScope=null,meterWasLive=false,meterStoppedAt=-Infinity;/* frames that predate a transport stop no longer drive the meters */const meterBallistics=new MeterBallistics();function mixerMeterReading(row,model=currentMixerModel()){return readMixerStripMeter(row,{projectId:model.projectId,frame:engine.currentMeterFrame()});}function mixerMeterDisplay(row,model=currentMixerModel(),now=Date.now()){const scope=`${model.projectId}|${engine.monitor?.generation??0}`;if(scope!==meterBallisticsScope){meterBallisticsScope=scope;meterBallistics.reset();}const live=!!(engine.playing||engine.previewing);if(meterWasLive&&!live)meterStoppedAt=now;meterWasLive=live;const reading=mixerMeterReading(row,model),fresh=reading.known&&(live||reading.receivedAt>meterStoppedAt),motion=meterBallistics.step(row.key,fresh?reading.value:0,now,{playing:live||fresh});return{...reading,level:motion.level,peak:motion.peak,active:motion.active};}function animate(){if(meterFrame!==null||document.documentElement.dataset.vegetableActive==='false')return;meterFrame=requestAnimationFrame(()=>{meterFrame=null;clearTimeout(meterStaleTimer);meterStaleTimer=null;if(windows.dragging){meterStaleTimer=setTimeout(animate,100);return;}const model=currentMixerModel(),now=Date.now();let active=false,expires=null;for(const strip of $$('.mixer-strip[data-mixer-row]')){const row=model.rows.find(row=>row.key===strip.dataset.mixerRow),meter=strip.querySelector('.meter'),fill=strip.querySelector('.meter-fill');if(!row||!meter||!fill)continue;const display=mixerMeterDisplay(row,model,now);paintMixerMeter(meter,fill,row,display);if(row.kind==='bus'&&row.id==='master'){/* FL's big "C" peak column mirrors the master reading (one ballistics step) */const peak=$('#mixer-strips .mixer-peak');if(peak)paintMixerMeter(peak.querySelector('.meter'),peak.querySelector('.meter-fill'),row,display);}if(display.active)active=true;if(display.known)expires=Math.min(expires??Infinity,display.receivedAt+MIXER_METER_MAX_AGE_MS);}if(active)animate();else if(expires!==null)meterStaleTimer=setTimeout(animate,Math.max(0,expires-now)+20);});}
engine.monitor.addEventListener('meters',animate);
// Saved mixer values shown after a save give way to the next canonical state
// (poll, undo, external change) once nothing is pending.
engine.session.addEventListener('state',()=>{if(mixerQueue?.holding&&!mixerQueue.busy&&!mixerRefreshRun&&!engine.interacting&&!engine.applying&&!engine.pending)mixerQueue.releaseHeld();});
// Live diagnostics: meter feed + channel message types every ~2 s while playing.
window.setInterval(()=>{if(!engine.playing)return;const m=engine.monitor,frame=engine.currentMeterFrame?.();clientLog('mixer-meters',{feed:engine.meterFeed?.stats,channels:m?.channelStats?.channels??null,peer:m?.peer?.connectionState??null,control:m?.control?.readyState??null,meters:m?.meters?.readyState??null,monitorProject:m?.projectId===engine.projectId,generation:m?.generation??null,frameFresh:!!frame&&Date.now()-frame.receivedAt<1500,frameLanes:frame?.lanes?.size??0,stripRows:document.querySelectorAll('.mixer-strip[data-mixer-row]').length});},2000);
// QA round 29: prove audibility without ears. While playing, every lane's meter peak (the
// engine's mixer_meters frames on the monitor peer) is sampled 4x/s; each lane's maximum is
// logged every 2 s as `lane-meter-signal` (silent lanes too, so "no signal" is visible).
{const peaks=new Map();let since=0,frames=0;window.setInterval(()=>{if(!engine.playing){peaks.clear();since=0;frames=0;return;}const now=Date.now(),frame=engine.currentMeterFrame?.();if(!since)since=now;
 if(frame&&now-frame.receivedAt<1500){frames++;for(const [laneId,peak]of frame.lanes||[])if(Number.isFinite(peak))peaks.set(laneId,Math.max(peaks.get(laneId)??0,peak));}
 if(now-since<2000)return;const names=new Map((project?.cloud?.rawProject?.lanes||[]).map(lane=>[lane.id,lane.name]));
 if(!peaks.size)clientLog('lane-meter-signal',{laneId:null,peak:null,signal:false,frames,reason:frames?'no-lane-meters':'no-fresh-meter-frames',windowMs:now-since});
 for(const [laneId,peak]of peaks)clientLog('lane-meter-signal',{laneId,name:names.get(laneId)??null,peak:Math.round(peak*1000)/1000,signal:peak>=.001,frames,windowMs:now-since});
 peaks.clear();since=now;frames=0;},250);}engine.session.addEventListener('state',animate);
const scopeContext=$('#scope').getContext('2d');scopeContext.strokeStyle='#9daf9c';scopeContext.beginPath();scopeContext.moveTo(0,17);scopeContext.lineTo(160,17);scopeContext.stroke();
$('#browser-wave').innerHTML='<path d="M0 26H180" stroke="currentColor" opacity=".25"/><text x="0" y="17" fill="currentColor" font-size="8" letter-spacing="2">FREESTYLE LIBRARY</text>';
function applyProjectUi(next){activeRackCancel?.();activePlaylistCancel?.();activePianoCancel?.();const id=next.cloud?.projectId||next.id||'',previousId=project?.cloud?.projectId||project?.id||'',sameProject=!!id&&id===previousId,remappedSelection=sameProject?[...playlistSelection.ids].map(id=>pendingPlacementIds.get(id)||id):[];if(sameProject&&pendingPlacementIds.has(selectedClip))selectedClip=pendingPlacementIds.get(selectedClip);if(!sameProject){pendingPlacementIds.clear();selectedClip=null;playlistZoomPrevious=null;pianoZoomPrevious=null;}if(id!==cursorProjectId){cursorProjectId=id;editCursorBeat=Math.max(0,Number(engine.session.positionAt?.().beat)||0);}project=next;if(mixRevision?.projectId&&mixRevision.projectId!==(engine.ready?engine.projectId:null))mixRevision.stop();timingDialog?.syncScope();playlistSelection.sync(project);playlistSelection.select(remappedSelection);for(const [localId,savedId]of pendingPlacementIds)if(project.clips.some(clip=>clip.id===savedId))pendingPlacementIds.delete(localId);if(!project.channels.length)project.channels=[{id:'empty',name:'Add a cloud channel',type:'cloud',volume:1,pan:0,effects:{}}];if(!project.patterns.length)project.patterns=[{id:'empty',name:'New pattern',bars:1,steps:{},notes:{}}];const sourceIds=Object.keys(pattern().cloudSources||{});selectedChannel=sourceIds.includes(selectedChannel)?selectedChannel:sourceIds[0]||project.channels[0].id;syncRackFocus();renderAll();animate();$('#cloud-led').classList.add('connected');}
engine.session.addEventListener('placement-created',event=>{const value=event.detail;if(value.projectId===engine.projectId&&value.trackId===engine.session.trackId&&value.contextVersion===(engine.session.contextVersion||0))pendingPlacementIds.set(value.localId,value.placementId);});
engine.onProject=next=>{if(windows.dragging){queuedProject=next;return;}applyProjectUi(next);};
// Optimistic history previews: same project, only the areas the step changes
// are repainted (a full renderAll per rapid ⌘Z press cost ~110 ms). The
// confirmed model renders everything through onProject when the chain settles.
engine.onProjectPreview=(next,areas=['playlist'])=>{if(windows.dragging){queuedProject=next;return;}if((next.cloud?.projectId||next.id)!==(project?.cloud?.projectId||project?.id)){applyProjectUi(next);return;}activePlaylistCancel?.();if(areas.includes('rack'))activeRackCancel?.();if(areas.includes('piano'))activePianoCancel?.();const selection=[...playlistSelection.ids];project=next;if(!project.channels.length)project.channels=[{id:'empty',name:'Add a cloud channel',type:'cloud',volume:1,pan:0,effects:{}}];if(!project.patterns.length)project.patterns=[{id:'empty',name:'New pattern',bars:1,steps:{},notes:{}}];if(!project.channels.find(c=>c.id===selectedChannel))selectedChannel=project.channels[0].id;playlistSelection.sync(project);playlistSelection.select(selection);if(areas.includes('patterns'))renderPatterns();if(areas.includes('rack'))renderRack();if(areas.includes('piano'))renderPiano();if(areas.includes('mixer'))renderMixer();renderPlaylist();};
engine.onProjectLoaded=()=>syncMixRevision();engine.monitor.addEventListener('connected',()=>syncMixRevision());window.addEventListener('online',()=>syncMixRevision());
engine.onEditSettled=()=>{renderMixer();if(!engine.interacting)renderRack();requestMixerInspection();queueCloudWaveforms();};
engine.onMetronome=renderMetronome;engine.onError=fail;
// QA round 18: every refused save (rack steps, fills, rotate, paste, Piano notes…)
// has already been rolled back to the saved project; say so, whoever flushed it.
engine.onEditRejected=error=>{clientLog('edit-rejected',{code:error?.code??null,status:error?.status??null,error:String(error?.message||error).slice(0,200),...Array.isArray(error?.changedClips)?{changedClips:JSON.stringify(error.changedClips).slice(0,600)}:{}});const message=error?.message||String(error);fail(Object.assign(error,{message:/^Not saved/.test(message)?message:`Not saved — the edit was rolled back. ${message}`}));error.rollbackShown=true;try{renderAll();}catch{}};engine.monitor.addEventListener('warning',e=>toast(e.detail.message));engine.monitor.addEventListener('connected',e=>{if(e.detail.projectId===engine.projectId&&e.detail.trackId){engine.session.trackId=e.detail.trackId;engine.refresh().catch(fail);}});engine.monitor.addEventListener('state',e=>{$('#session-status').textContent=e.detail.state==='connected'?'CLOUD AUDIO LIVE':e.detail.state==='error'?'CLOUD AUDIO BLOCKED':'CLOUD ENGINE';});engine.onPatternHistory=()=>{try{historyJournalObserved();}catch{}paintHistoryFeedback();};engine.onStatus=message=>{queueRackControlSync();renderHistoryControls();if(playClockRead||$('#play').classList.contains('starting'))paintTransportBusy();const visible=filePickerFeedbackMessage(playClockReadFeedback(message));$('#status-message').textContent=visible;
  // FL keeps "Undone: …" / "Redone: …" in the hint panel until the next hint; routine engine
  // status (saving, saved, refreshed) goes to the status bar only. Problems still show here.
  const hint=$('#hint').textContent;if(!/^(Undone|Redone): /.test(hint)||/fail|error|not saved|refused|conflict|uncertain|reload/i.test(visible))$('#hint').textContent=visible;
  // A step that completed while the engine was still busy painted the pending "Undo: …"; the
  // first status after the engine settles shows FL's "Undone: …" for it.
  try{if(!historyFeedbackBusy())showHistoryHint();}catch{}};
window.addEventListener('vegetable-cloud-project',e=>{if(e.detail.projectId&&(e.detail.projectId!==engine.projectId||e.detail.trackId&&e.detail.trackId!==engine.session.trackId))engine.load(e.detail.projectId,e.detail.trackId).then(()=>requestMixerInspection()).catch(fail);});
renderAll();getCloudStatus().catch(()=>{});
// Inside Freestyle: open the project Studio has open, follow project/view changes (freestyle-embed.js).
/** Another Freestyle view took the screen: pause in place (the Default studio keeps the
 * position); pattern previews and takes have no pause, so they stop. */
async function pauseForHiddenView(){
 if(engine.previewing||engine.playAttempt||engine.recorder?.recording||engine.recordingContext||mode==='pattern'&&engine.playing)return stop();
 if(!engine.playing)return;++transportUiVersion;await engine.pause();
 if(playheadFrame!==null)cancelAnimationFrame(playheadFrame);playheadFrame=null;
 try{setPlaylistCursor(engine.positionAt().beat);}catch{}$('#play').classList.remove('playing');$('#play').textContent='▶';$('#status-message').textContent='Paused';
}
const embeddedStudio=startEmbeddedStudio({engine,stop:()=>stop(),pause:()=>pauseForHiddenView(),releaseInput:()=>{typingAudition.releaseAll();midiInput?.releaseAll();cloudLibrary?.stopPreview();},onLoaded:()=>requestMixerInspection(),onError:fail,repaint:()=>{animate();try{updateTick(engine.positionAt?.()||{beat:engine.beat,playing:engine.playing,mode});}catch{}},log:clientLog,
 onStatus:({hint,status,session})=>{$('#hint').textContent=hint;$('#status-message').textContent=status;$('#session-status').textContent=session;}});
animate();
// Small read-only diagnostic surface for verifying the currently running workstation.
function coreFileEditable({ignoreAudioImport=false}={}){return !rackRegistrationBusy&&!samplePlacementBusy&&!engine.historyPending&&!engine.patternHistory?.busy&&(ignoreAudioImport||!audioImportBusy)&&!playlistClipboardBusy&&!playlistClonePending&&engine.ready&&!engine.loading&&!engine.applying&&!engine.interacting&&!mixerBusy()&&!laneCreate?.busy&&!laneCreateDialog?.busy&&!rangeBusy()&&!sliceBusy()&&!rackClipboardBusy&&!rackGraph?.busy&&!cloudLibrary?.writeBusy;}
function fileImportScope(){return {projectId:engine.projectId,trackId:engine.session.trackId,loadVersion:engine.loadVersion||0,contextVersion:engine.session.contextVersion||0};}
function playlistDropLaneLabel(lane,track){return lane?lane.name||`Track ${track+1}`:'New audio lane';}
// ── Edits during a file import queue behind it in order (playbook: queue, never refuse) ──
// Only the import (OS drop / audio import) may be what blocks; any other in-flight cloud work still refuses.
// Queued edits run after the import's writes and refresh land, so each save adopts the import's revision.
function fileImportInFlight(){return !!(fileDrop?.busy||audioImportBusy);}
function importEditGate(){try{return fileImportInFlight()&&!historyQueueDepth&&!historyUiOperation&&!engine.historyPending&&!workspaceBusy({ignoreFileImport:true,ignorePatternHistory:true});}catch{return false;}}
function queueBehindImport(label,apply){
 importEditQueue.push({label,apply,queuedAt:performance.now(),scope:JSON.stringify(fileImportScope())});clientLog('import-edit-queue',{event:'queued',label,depth:importEditQueue.length});
 if(!importWaitTimer)importWaitTimer=setTimeout(()=>{importWaitTimer=null;if(importEditQueue.length){$('#hint').textContent=`Waiting for import… ${importEditQueue.length} edit${importEditQueue.length===1?'':'s'} queued`;$('#status-message').textContent=$('#hint').textContent;}},300);
 scheduleImportDrain();return true;
}
function scheduleImportDrain(){if(importDrainTimer||!importEditQueue.length)return;importDrainTimer=setTimeout(()=>{importDrainTimer=null;drainImportQueue();},30);}
function drainImportQueue(){
 if(!importEditQueue.length)return;
 if(fileImportInFlight()||workspaceBusy()||engine.applying||engine.interacting||activePlaylistCancel){scheduleImportDrain();return;}
 clearTimeout(importWaitTimer);importWaitTimer=null;
 importDraining=true;
 try{while(importEditQueue.length){const next=importEditQueue.shift();if(next.scope!==JSON.stringify(fileImportScope())){clientLog('import-edit-queue',{event:'dropped',label:next.label,reason:'project_changed'});continue;}clientLog('import-edit-queue',{event:'apply',label:next.label,waitedMs:Math.round(performance.now()-next.queuedAt)});try{next.apply();}catch(error){fail(error);}if(workspaceBusy()&&importEditQueue.length){scheduleImportDrain();return;}}}finally{importDraining=false;}
 if(/^Waiting for import…/.test($('#hint').textContent))$('#hint').textContent='';
}
function fileDropTarget(event,{entries=[]}={}){
 const special=entries.length>0&&entries.every(entry=>entry.kind==='midi'||entry.kind==='project');
 if(special)return{zone:'import',accepted:true,message:entries[0].kind==='midi'?'Drop MIDI to review instrument assignments.':'Drop the DAW project to import it into Freestyle.'};
 if(event.target?.closest?.('#rack')){
  // Studio API projects upload audio as sample-only Rack channels (no Playlist take).
  if(rackUploadSupported())return{zone:'rack',accepted:true,message:entries.length===0?'Drop audio to add Channel Rack samples, or MIDI / a DAW project to import.':`Channel Rack · add ${entries.length} sample${entries.length===1?'':'s'} to ${pattern().name||'the current pattern'} (no Playlist clip)`};
  return{zone:'rack',accepted:entries.length===0,message:entries.length===0?'Drop MIDI or a DAW project to import; move audio onto the Playlist.':'Direct disk-to-Rack needs a Freestyle Studio API project. Import audio into the Playlist, then choose Add to Channel Rack from its clip menu.'};
 }
 const grid=event.target?.closest?.('.lane-grid')||event.target?.closest?.('.track-lane')?.querySelector('.lane-grid'),surface=event.target?.closest?.('#arrangement-scroll')||event.target?.matches?.('#playlist,.playlist-content,.playlist-timeline');
 if(!grid&&!surface)return{zone:'outside',accepted:entries.length===0,message:entries.length===0?'Drop MIDI or a DAW project to import; move audio onto the Playlist.':'Drop audio onto a Playlist lane or its empty timeline area.'};
 const track=grid?Number(grid.dataset.track):null,laneScope={track,timelineLaneIds:project.cloud?.timelineLaneIds||[],lanes:project.cloud?.rawProject?.lanes||[],placements:project.cloud?.rawProject?.placements||[]},audioLane=playlistDropLane(laneScope),strictAudioLane=playlistDropLane(laneScope,{strict:true}),left=grid?playlistGridOrigin(grid):$('#arrangement').getBoundingClientRect().left+PLAYLIST_GUTTER,beat=playlistDropBeat({clientX:event.clientX,left,barWidth,snap:event.altKey?0:+$('#snap').value});
 /* QA r7: the import ghost sits on the row the new track will take (bindPlaylistDropRow's clamp), not the cursor row. */
 const ghostTrack=strictAudioLane&&Number.isInteger(track)?track:clampedPlaylistDropRow(Number.isInteger(track)?track:Number.MAX_SAFE_INTEGER);
 return{zone:'playlist',accepted:true,track,ghostTrack,laneId:(entries.length?strictAudioLane:audioLane)?.id||null,audioLaneId:strictAudioLane?.id||null,beat,message:`Playlist · ${playlistDropLaneLabel(entries.length?strictAudioLane:audioLane,track)} · bar ${Math.floor(beat/4)+1}, beat ${Number((beat%4+1).toFixed(6))}${!event.altKey&&Number($('#snap').value)>0?' (snapped)':''}`};
}
function chooseDroppedProjectFormat(file){if(/\.flp$/i.test(file.name))return Promise.resolve('flp');if(/\.logicx$/i.test(file.name))return Promise.resolve('logic');const d=dialog('Import project','<p>Choose the project type inside this ZIP.</p><button class="zip-fl">FL Studio loop package</button><button class="zip-logic">Logic project bundle</button>');return new Promise(resolve=>{d.querySelector('.zip-fl').onclick=()=>{resolve('flp');d.close();};d.querySelector('.zip-logic').onclick=()=>{resolve('logic');d.close();};d.addEventListener('close',()=>resolve(null),{once:true});});}
fileDrop=new FileDropController({element:document.body,overlayHost:$('#desktop'),getScope:fileImportScope,isEditable:coreFileEditable,resolveTarget:fileDropTarget,onStatus:toast,onChange:snapshot=>{mixerView?.render();logicShellHooks.fileDrop?.(snapshot);},onFiles:async(files,context)=>{
 const special=context.entries.filter(entry=>entry.kind!=='audio');if(special.length&&files.length!==1)throw new Error('Drop MIDI or a DAW project by itself. Multiple audio files can be dropped together.');
 if(special[0]?.kind==='midi'){context.assertCurrent();return midiImport(files[0],{fromDrop:true});}
 if(special[0]?.kind==='project'){const format=await chooseDroppedProjectFormat(files[0]);if(!format)return;context.beginWrite();const result=await engine.importDawProject(files[0],format),id=result.project?.id||result.projectId;if(!id||engine.projectId!==id)throw new Error('The project import returned without loading its project. Inspect the import result.');context.adoptScope(fileImportScope());toast('Project imported into Freestyle.');return result;}
 // assertCurrent also requires an editable workspace, which the Rack upload itself
 // fences; begin the write before that fence and check scope/abort inside it.
 if(context.target?.zone==='rack'){context.beginWrite();const dropScope=JSON.stringify(context.scope);return uploadFilesToRack(files,{check:()=>{if(context.signal.aborted||JSON.stringify(fileImportScope())!==dropScope)throw new Error('The project changed. Remaining files were not uploaded.');}});}
 clientLog('playlist-drop',{source:'os-file',files:files.length,track:Number.isInteger(context.target?.track)?context.target.track:null,laneId:context.target?.audioLaneId||null,snappedBeat:context.target?.beat??null,drag:null});await engine.flush();context.assertCurrent();const beat=context.target?.beat;if(typeof beat!=='number'||!Number.isFinite(beat)||beat<0)throw new Error('Choose a valid Playlist drop position.');const startSeconds=project.cloud?.rawProject?.timingMap?.isConstantTempo===false?(await timingMap.convert({beat})).seconds:beat*60/project.bpm;context.assertCurrent();if(typeof startSeconds!=='number'||!Number.isFinite(startSeconds)||startSeconds<0)throw new Error('Freestyle did not confirm the audio drop time.');const results=[],dropRows=[],row=Number.isInteger(context.target?.track)?context.target.track:null;for(const file of files){context.beginWrite();const index=results.length,existing=index===0&&context.target?.audioLaneId;
  // Same row binding as a Browser drop: the first file's new lane takes the dropped row, later files the rows below it (FL).
  const result=await importAudioWithHistory(file,null,{...(existing?{laneId:context.target.audioLaneId}:{}),startSeconds},{onImported:imported=>{if(row===null)return;const bound=bindPlaylistDropRow(imported,row+index,{source:'os-file',file:index});if(bound)dropRows.push({...bound,clipId:imported.clipId||null});}});results.push(result);context.assertCurrent();}
 for(const bound of dropRows)clientLog('playlist-drop-row',playlistDropRowRecord(bound,bound.clipId));
 await engine.refresh();context.assertCurrent();const pending=results.filter(result=>result?.attachmentPending).length;toast(pending?`${results.length} audio file${results.length===1?'':'s'} saved at the drop position; live loading is unconfirmed for ${pending}. Inspect the saved clips before importing again.`:`${results.length} audio file${results.length===1?'':'s'} imported at the drop position.`);return results;
}});
function focusCreatedLane(id){if(!id)return;selectedMixerKey=mixerRowKey('lane',id);mixerChannel=id;renderMixer();const index=project.cloud?.timelineLaneIds?.indexOf(id);if(index>=0)$('#track-lanes').children[index]?.scrollIntoView?.({block:'nearest'});}
laneCreate=new CloudLaneCreate({engine,onChange:()=>{mixerView?.render();laneCreateDialog?.render();}});
const emptyInstrument=new CloudEmptyInstrument({engine,onChange:()=>{mixerView?.render();laneCreateDialog?.render();}});
laneCreateDialog=new CloudLaneCreateDialog({controller:laneCreate,onLaneCreate:options=>createLaneWithHistory(options),getScope:fileImportScope,isEditable:()=>directLevelEditable()&&!engine.interacting,onStatus:toast,getInstrumentAvailability:()=>uiFeature('create_instrument'),loadInstrumentOptions:()=>emptyInstrument.catalog(),onInstrument:args=>{requireUiFeature('create_instrument');return createLaneWithHistory(args,{instrument:true});},onInstrumentInspect:()=>emptyInstrument.inspect(),onCreated:async receipt=>{await engine.refresh();if(receipt.kind==='instrument'){const lane=(project.cloud?.rawProject?.lanes||[]).find(lane=>lane.id===receipt.receipt.laneId&&lane.kind==='instrument');if(!lane||!receipt.receipt.emptyConfirmed)throw new Error('Inspect the saved tracks to confirm the empty instrument lane.');focusCreatedLane(lane.id);}else focusCreatedLane(receipt.lane?.id);},onInspected:async()=>{await engine.refresh();renderAll();},onSettled:()=>engine.onEditSettled()});
$('#new-track').onclick=()=>{if(!engine.ready)return openCloudPanel().catch(fail);try{return laneCreateDialog.open();}catch(error){fail(error);}};
window.vegetableStudio={get embedded(){return embeddedStudio;},bridgeDiagnostics,pluginInventory,get cloudQueueTimeoutMs(){return cloudQueueTimeoutMs;},set cloudQueueTimeoutMs(value){if(Number.isFinite(value)&&value>=0)cloudQueueTimeoutMs=value;},get historyStepWaitMs(){return historyStepWaitMs;},set historyStepWaitMs(value){if(Number.isFinite(value)&&value>=0)historyStepWaitMs=value;},cloudBlockers(){const now=performance.now();return{reasons:cloudBlockerReasons().map(reason=>({reason,forMs:Math.round(now-(cloudBlockerSince.get(reason)??now))})),queueWaits:structuredClone(cloudQueueWaits)};},get midiInput(){return midiInput;},get pianoPreviewNotes(){return pianoPreviewNotes;},get playlistCloneState(){const state=lastPlaylistClone?.snapshot();return state?{...state,busy:state.busy||playlistClonePending}:playlistClonePending?{status:'flushing',busy:true}:null;},get project(){return clone(project);},get playlistSelection(){return [...playlistSelection.ids];},get playing(){return engine.playing;},get mode(){return mode;},engine,automationStore,sampleEditor,regionEffects,timingMap,timingDialog,windows,timelineViewport,pianoViewport,playlistLoop,playlistNavigator,pianoNavigator,clipWaveforms,rangeEdits,get audioSlices(){return audioSlices.map(entry=>({projectId:entry.projectId,revision:entry.revision,state:entry.controller.snapshot()}));},playlistKeyboard,noteProperties,playlistStroke,rackStepGesture,rackGraph,rackSelector,rackClipboardWriter,rackSampleRegistration,restMixer,mixerQueue,mixRevision,resetChannelLevels,mixerState,mixerPan,mixerMaster,mixerLive,mixerRouting,mixerRoutingDialog,mixerView,fileDrop,laneCreate,emptyInstrument,laneCreateDialog,playlistClipboard,get playlistClipboardRecords(){return playlistClipboardRecords.map(record=>({projectId:record.projectId,applied:record.applied,state:record.controller.snapshot()}));},get rackControlState(){return rackControlWidgets.map(widget=>({label:widget.button.getAttribute('aria-label'),active:widget.active,pending:widget.pending,gesture:widget.gesture?{kind:widget.gesture.kind,pointerId:widget.gesture.pointerId,before:widget.gesture.before,value:widget.gesture.value}:null,valid:widget.active?widget.valid():null}));},get mixerModel(){return clone(currentMixerModel());},get projectRack(){return clone(currentProjectRack());},get rackViewError(){return rackViewError;},version:'0.4.0-fl-cloud'};

$('#mode').classList.add('song');

async function connectLiveCloudAudio(){
 const scope=fileImportScope(),monitor=engine.monitor,assertCurrent=()=>{if(!engine.ready||engine.loading||engine.session.projectId!==scope.projectId||JSON.stringify(fileImportScope())!==JSON.stringify(scope))throw Object.assign(new Error('The cloud project changed while its audio monitor was connecting.'),{name:'AbortError',code:'monitor_scope_changed'});};
 assertCurrent();const generation=monitor.generation,bound=monitor.projectId===scope.projectId&&monitor.trackId===scope.trackId;let resumeError;
 // Resume a bound sink in this user gesture; audibility remains independently gated.
 const gestureResume=bound?Promise.resolve(monitor.resume()).catch(error=>{resumeError=error;}):Promise.resolve();
 await engine.ensureMonitorReady({retry:true});assertCurrent();await gestureResume;assertCurrent();if(resumeError)throw resumeError;
 if(!bound||monitor.generation!==generation){await monitor.resume();assertCurrent();}
 return true;
}
$('.monitor').title='Connect live Freestyle cloud audio';$('.monitor').style.cursor='pointer';$('.monitor').onclick=()=>connectLiveCloudAudio().catch(fail);$('.monitor').oncontextmenu=e=>{e.preventDefault();menu(e,[['Connect live cloud audio','',()=>connectLiveCloudAudio()],['Listen to rendered cloud preview','',()=>engine.listenPreview()]]);};

// Pointer gestures prevent the browser's default focus change. Give the real
// editor surface its shortcuts back after a pattern dropdown or toolbar field.
$('#playlist').addEventListener('pointerdown',event=>{
 if(![0,2].includes(event.button)||event.isPrimary===false||!event.target.closest('#arrangement-scroll')||event.target.closest('input,textarea,select,button,a[href],summary,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="combobox"],[role="textbox"],[role="slider"],[role="scrollbar"]'))return;
 $('#playlist').focus({preventScroll:true});
},true);
$('#piano').addEventListener('pointerdown',event=>{
 if(![0,2].includes(event.button)||event.isPrimary===false||!event.target.closest('#piano-scroll,#velocity-grid')||event.target.closest('input,textarea,select,button,a[href],summary,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="combobox"],[role="textbox"],[role="slider"],[role="scrollbar"]'))return;
 $('#piano').focus({preventScroll:true});
},true);
document.addEventListener('pointerdown',e=>{if(e.target.closest('#desktop'))clipGestureDiagnostics.surface=clipPointerTarget(e);if(e.target.closest('#mixer input[type=range]')||e.target.closest('#piano-grid')&&(pianoZoomRequest(e)||pianoScrubRequest(e)))return;if(!rackClipboardBusy&&!rackGraph?.writing&&e.target.closest('#desktop .clip,#desktop .piano-note,#desktop input[type=range],#piano-grid,#velocity-grid'))engine.interacting=true;},true);
function finishPointerInteraction(event){if(activePianoCancel||activeRackCancel||activePlaylistCancel||mixerView?.active)return;if(engine.interacting){engine.interacting=false;if(engine.pending)engine.update(engine.pending);}}
document.addEventListener('pointerup',finishPointerInteraction,true);document.addEventListener('pointercancel',finishPointerInteraction,true);window.addEventListener('blur',()=>{activeRackCancel?.();activePlaylistCancel?.();finishPointerInteraction();});
for(const type of ['pointerup','pointercancel'])document.addEventListener(type,()=>{if(waveformPaintPending)queueCloudWaveforms();});
window.addEventListener('pointerup',()=>{if(waveformPaintPending)queueCloudWaveforms();});
window.addEventListener('beforeunload',()=>{activePianoCancel?.();clearTimeout(rackControlSyncTimer);for(const widget of rackControlWidgets)widget.destroy();clearTimeout(waveformTimer);engine.session.close();clipWaveforms.destroy();noteProperties?.destroy();playlistStroke.destroy();rackStepGesture.destroy();rackGraph.destroy();rackSelector.destroy();fileDrop.destroy();laneCreateDialog.destroy();laneCreate.destroy();emptyInstrument.destroy();mixerView.destroy();mixerRoutingDialog.destroy();mixerRouting.destroy();mixerPan.destroy();mixerMaster.destroy();mixerLive.destroy();mixerState.destroy();},{once:true});

$('#piano-more').onclick=pianoMenu;$('#piano-tools').onclick=pianoMenu;$('#piano-snap').onclick=pianoSnapMenu;$('#piano-snap').oncontextmenu=e=>{e.preventDefault();pianoSnapMenu(e);};$('#piano-undo').onclick=()=>{activePianoCancel?.();undo();};
// Escape dismisses an open context menu only (never the plugin window or dialog under it).
// Keyboard-managed menus (role=menu, e.g. Piano snap) handle Escape and focus return themselves.
document.addEventListener('keydown',e=>{const m=$('#context-menu');if(e.key==='Escape'&&m&&!m.classList.contains('hidden')&&m.getAttribute('role')!=='menu'){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();m.classList.add('hidden');}},true);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&(activeRackCancel||activePianoCancel||activePlaylistCancel)){e.preventDefault();(activeRackCancel||activePianoCancel||activePlaylistCancel)();}},true);
window.addEventListener('blur',()=>activePianoCancel?.());

document.addEventListener('keyup',e=>{if(playlistKeyboard.keyUp(e))return;typingAudition.keyUp(e);if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))finishPointerInteraction();});window.addEventListener('blur',()=>{typingAudition.releaseAll();midiInput?.releaseAll();engine.releaseNotes();});

$('#rack').addEventListener('dragover',e=>{if([...e.dataTransfer.types].includes('application/vegetable-library-sound')){e.preventDefault();e.dataTransfer.dropEffect='copy';$('#rack').classList.add('library-drop-target');}});
$('#rack').addEventListener('dragleave',e=>{if(!$('#rack').contains(e.relatedTarget))$('#rack').classList.remove('library-drop-target');});
$('#rack').addEventListener('drop',e=>{const raw=e.dataTransfer.getData('application/vegetable-library-sound');if(!raw)return;e.preventDefault();e.stopPropagation();$('#rack').classList.remove('library-drop-target');try{const item=JSON.parse(raw);if(item?._libraryView==='rack-channel')return;if(!item.id||!cloudLibrary)throw new Error('Choose a sound returned by the cloud library.');cloudLibrary.execute(()=>cloudLibrary.addSound(item));}catch(error){fail(error);}});
// Browser / Rack sample -> Playlist: hovered lane + snapped beat; empty space
// (or a non-audio lane) omits laneId so Freestyle creates a new audio lane.
$('#arrangement-scroll').addEventListener('dragover',e=>{if(![...(e.dataTransfer?.types||[])].includes(LIBRARY_SOUND_MIME)||!playlistSamplePlacementSupported())return;const target=libraryPlaylistDropTarget(e);if(!target)return;e.preventDefault();e.dataTransfer.dropEffect=samplePlacementBusy||!coreFileEditable()?'none':'copy';$('#arrangement-scroll').classList.add('library-drop-target');$('#hint').textContent=target.message;});
$('#arrangement-scroll').addEventListener('dragleave',e=>{if(!$('#arrangement-scroll').contains(e.relatedTarget))$('#arrangement-scroll').classList.remove('library-drop-target');});
$('#arrangement-scroll').addEventListener('drop',e=>{if(![...(e.dataTransfer?.types||[])].includes(LIBRARY_SOUND_MIME)&&!e.dataTransfer?.getData?.(LIBRARY_SOUND_MIME))return;dropLibrarySoundOnPlaylist(e).catch(fail);});
document.addEventListener('dragend',()=>$('#arrangement-scroll').classList.remove('library-drop-target'));
Object.assign(window.vegetableStudio,{rackSampleUpload,samplePlacement,patternLengthDialog:id=>patternLengthDialog(project.patterns.find(row=>row.id===id||row.cloudId===id))});

// ── Disabelton shell (logic-shell.js / logic-keys.js / logic-context-menu.js) ──
// Logic control bar, Tracks-area menus and tools, Inspector, panes and key commands.
// Every action below is an existing handler: transport stays on the fast mozart-control
// path, edits stay on the guarded optimistic/history paths.
function playheadBeatNow(){const t=engine.positionAt?.()||{};return engine.playing&&Number.isFinite(Number(t.beat))?Number(t.beat):editCursorBeat;}
/** Logic shows only real tracks: rows past the saved lanes (and past any region) render as empty Tracks space that still accepts drops. */
function logicRealTrackCount(){return Math.max(project.cloud?.timelineLaneIds?.length||0,...allClips().map(clip=>Number(clip.track)+1).filter(Number.isFinite),project.cloud?0:(project.trackNames?Object.keys(project.trackNames).length:0));}
/** Logic track icon kind: audio (waveform), instrument (keyboard) or pattern (step grid: only Step Sequencer patterns placed). */
function logicTrackKind(track){const kind=(project.cloud?.rawProject?.lanes||[]).find(lane=>lane.id===project.cloud?.timelineLaneIds?.[track])?.kind,regions=(project.clips||[]).filter(clip=>clip.track===track);if(kind==='audio'||!kind&&!regions.length)return 'audio';const patterns=regions.map(clip=>project.patterns.find(item=>item.id===clip.patternId)).filter(Boolean);return patterns.length&&patterns.every(item=>{try{return editorForPattern(item)==='step';}catch{return false;}})?'pattern':'instrument';}
function regionMuteState(clip){return clip?.patternId?!!clip.cloudRaw?.muted:audioClipMuteValue(clip?.id);}
/** Logic ⌃M: toggle the mute of these regions as one gesture (same plans as the Mute tool). */
function toggleRegionMutes(ids){
 if(!playlistEditable())return toast('Wait for the current cloud operation to finish.');
 const clips=allClips().filter(clip=>ids.includes(clip.id));if(!clips.length)return;
 const first=regionMuteState(clips[0]);if(first===null)return fail(new Error('Reload the saved clip mute before toggling it.'));
 const muted=!first,audioIds=new Set((project.audioClips||[]).map(clip=>clip.id)),patternIds=clips.filter(clip=>!audioIds.has(clip.id)).map(clip=>clip.id),audioClipIds=clips.filter(clip=>audioIds.has(clip.id)).map(clip=>clip.id);
 const plan=patternIds.length?planPatternClipMute(project,{clipIds:patternIds,muted}):null,audioPlan=audioClipIds.length?planAudioClipMute(project,{clipIds:audioClipIds,muted}):null;
 if(plan?.changed&&!edit(()=>{project=plan.project;}))return;
 if(audioPlan?.changed)return commitAudioClipMutes(audioPlan.changes).catch(fail);
}
function renameRegion(clip){
 if(!clip?.patternId)return toast('Freestyle does not store names for audio regions.');
 const p=project.patterns.find(item=>item.id===clip.patternId),current=project;
 return textDialog('Rename Region','Region name',clip.name??p?.name??'Region',name=>{if(project!==current||!findClip(clip.id))return toast('The region changed; reopen Rename.');edit(()=>{const target=findClip(clip.id);if(target)target.name=name;});});
}
function setTrackMixerControl(row,control,before,value){const target=playlistTrackMixerRow(project.cloud?.timelineLaneIds?.[row]);if(!target?.controls?.[control]?.enabled)throw new Error('Open the Mixer for this track to change it.');return mixerControl({row:structuredClone(target),before,value,scope:mixerScope()},control);}
function masterMixerRow(){try{return currentMixerModel().rows.find(row=>row.kind==='bus'&&row.id==='master')||null;}catch{return null;}}
const logicShell=installLogicShell({
 document,menu,toast,fail,dialog,textDialog,
 getProject:()=>project,findClip,allClips,selectedIds:()=>playlistSelection.ids,
 selectRegions:ids=>{playlistSelection.select(ids);selectedClip=playlistSelection.ids.values().next().value||null;paintPlaylistSelection();},
 activeEditor,dialogOpen:event=>shortcutDialogOpen(event),showWindow,windowVisible:id=>!!$('#'+id)&&!$('#'+id).classList.contains('hidden'),
 getTool:()=>tool,setTool:name=>$(`button[data-tool="${name}"]`)?.click(),editable:()=>playlistEditable(),
 playheadBeat:playheadBeatNow,jumpTo:beat=>playlistCursorJump(beat),goToStart:()=>playlistHome(),clock:()=>engine.positionAt?.()||{},
 toggleCycle:()=>toggleLoopPlayback(),setLocators:(startBeat,endBeat)=>playlistLoop.apply({enabled:true,startBeat,endBeat}),
 record:()=>$('#record').click(),toggleMetronome:()=>toggleMetronomeUi(),toggleTyping:()=>typingToggle.click(),typingEnabled:()=>typingEnabled,
 undo,redo,showHistory,clipboard:action=>playlistClipboardAction(action),deleteSelected,repeat:()=>queuePlaylistDuplicate(),
 split:(clip,beat)=>splitClipOptimistic(clip,beat),snapBeat:beat=>quantize(beat),barWidth:()=>barWidth,
 toggleRegionMute:toggleRegionMutes,regionMuted:regionMuteState,renameRegion,
 openPianoRoll:clip=>{selectPattern(clip.patternId);showWindow('piano');},makeUnique:clip=>makeUnique(clip.id),extendClip:clip=>window.ablClipView?.extendClip?.(clip)??false,openSampleEditor:clip=>openSampleEditor(clip),
 regionEffect:clip=>regionEffects.open({clipId:clip.cloudId}),addToStepSequencer:clip=>addAudioClipToRack(clip),openAutomation:clip=>openAutomation(clip),
 reloadWaveform:clip=>{clipWaveforms.invalidate(clip.cloudId);queueCloudWaveforms();},regionProperties:clip=>audioProperties(clip),
 audioRange:()=>rangeEdits.open(),timing:()=>timingDialog.open(),clearPatternRegions:()=>clearPlaylistConfirm(),
 newTracks:()=>$('#new-track').click(),importAudio:()=>{importedTarget=null;$('#import-audio').click();},openCloudPanel:()=>openCloudPanel(),
 bounce:()=>exportWav(),importMidi:()=>midiImport(),undoHistory:()=>undoHistoryDialog(),deleteTrack:row=>deletePlaylistTrack(row),duplicateTrack:row=>duplicatePlaylistTrack(row),moveTrack:(row,to)=>dragPlaylistTrack(row,to),
 view:()=>playlistView(),applyView:view=>applyPlaylistView(view),zoomBy:(factor,anchor)=>timelineViewport.zoomBy(factor,anchor),zoomToFit:()=>fitPlaylistView(),minScale:()=>timelineViewport.min,maxScale:()=>timelineViewport.max,
 laneId:row=>project.cloud?.timelineLaneIds?.[row]||null,laneKind:row=>(project.cloud?.rawProject?.lanes||[]).find(lane=>lane.id===project.cloud?.timelineLaneIds?.[row])?.kind||null,trackName:row=>project.trackNames?.[row]||`Track ${row+1}`,
 trackMixerRow:row=>playlistTrackMixerRow(project.cloud?.timelineLaneIds?.[row]),toggleTrackMute:row=>togglePlaylistTrackMute(row),toggleTrackSolo:row=>togglePlaylistTrackSolo(row),setTrackControl:setTrackMixerControl,liveTrackControl:liveTrackMixerControl,liveMixGesture,
 masterRow:masterMixerRow,setMasterGain:(before,value)=>{const row=masterMixerRow();if(!row?.controls?.gain?.enabled)throw new Error('Stereo Out gain is unavailable.');return mixerControl({row:structuredClone(row),before,value,scope:mixerScope()},'gain');},
 selectMixerLane:laneId=>{selectedMixerKey=mixerRowKey('lane',laneId);mixerChannel=laneId;renderMixer();},
 /* Session View drop: the same placement the Arrangement lane drop makes (one clip of the pattern's own length), at an explicit beat. */placePattern:(patternId,track,beat)=>{const p=project.patterns.find(item=>item.id===patternId);if(!p||!Number.isInteger(track)||track<0||!Number.isFinite(beat)||beat<0)return false;clientLog('playlist-drop',{source:'session-pattern',track,laneId:project.cloud?.timelineLaneIds?.[track]||null,patternId,bpm:project.bpm,beat});edit(()=>project.clips.push({id:uid(),patternId,track,start:beat,length:patternLengthBeats(p)}));return true;},createRegionAt:(track,beat,kind)=>typeof window.disabelton?.createPatternRegionAt==='function'?window.disabelton.createPatternRegionAt(track,beat,kind):toast('Region creation is not available yet.'), logicCopy, cancelFileDrop:()=>fileDrop?.cancel(),trackRect:row=>{const grid=$(`#track-lanes .lane-grid[data-track="${row}"]`),host=$('#arrangement');if(!grid||!host)return null;const g=grid.getBoundingClientRect(),h=host.getBoundingClientRect();return{left:g.left-h.left,top:g.top-h.top,height:g.height};},
 repeatNotes:()=>{if(!selectedNotes.size)return toast('Select notes to repeat (⌘R).');return duplicatePianoNotes();},channelStripSetting:(laneId,event)=>channelStripSettingMenu(laneId,event),
 toggleMixer:force=>toggleMixer(force),toggleAutomation:force=>toggleAutomationView(force),mountInspectorStrips:(element,options)=>mountInspectorStrips(element,options),mixerReady:()=>!!mixerStripViewOptions
});
// Logic opens with the Tracks area filling the window: Mixer (X) and Editors (E / P / double-click) closed.
try{toggleMixer(false);closeEditorPane();}catch(error){clientLog('disabelton-default-layout',{message:String(error?.message||error).slice(0,160)});}
for(const button of $$('[data-window]'))button.classList.toggle('lit',!!$('#'+button.dataset.window)&&!$('#'+button.dataset.window).classList.contains('hidden'));
logicShell.decorateTracks();logicShell.renderInspector();
window.vegetableStudio.logicShell=logicShell;
/* Fade tool, region Gain / Fade In / Fade Out, track R / I, Count-in and LCD key (logic-region-tools.js). */
const logicRegionTools=installRegionTools({document,hooks:logicShellHooks,getProject:()=>project,findClip,allClips,getTool:()=>tool,editable:()=>playlistEditable(),toast,fail,
 studioClient:()=>ablStudioClient(),projectId:()=>engine.ready&&!engine.loading?engine.projectId:null,history:()=>engine.patternHistory,
 invalidateWaveform:clipId=>{clipWaveforms.invalidate(clipId);queueCloudWaveforms();},renderInspector:()=>logicShell.renderInspector(),
 laneId:row=>project.cloud?.timelineLaneIds?.[row]||null,laneKind:row=>(project.cloud?.rawProject?.lanes||[]).find(lane=>lane.id===project.cloud?.timelineLaneIds?.[row])?.kind||null,trackName:row=>project.trackNames?.[row]||`Track ${row+1}`,
 recording:()=>!!(engine.recorder?.recording||engine.recordingContext||ablMidiTake.active),log:clientLog,menu,beatsPerBar:()=>Number(project?.beatsPerBar)||4});
window.vegetableStudio.regionTools=logicRegionTools;
window.disabelton=Object.assign(window.disabelton||{},{selectFadeTool:()=>$('button[data-tool="fade"]')?.click(),channelStripSetting:(laneId,event)=>channelStripSettingMenu(laneId,event),copyChannelStripSetting:laneId=>{const item=channelStripSettingEntries(laneId).find(entry=>entry.id==='copy-strip');return item.disabled?toast(item.title):item.run();},pasteChannelStripSetting:laneId=>{const item=channelStripSettingEntries(laneId).find(entry=>entry.id==='paste-strip');return item.disabled?toast(item.title):item.run();},openHumanize:()=>openHumanizeDialog(dialog,{selection:selectedNotes.size,onApply:options=>transformPianoNotes(notes=>humanizeNotes(notes,options))}),createBus:()=>openBusSettings().catch(fail)});
/* ── Disabelton Live shell (abl-shell.js / abl-layout.js / abl-keys.js / abl-session.js) ──
 * Live control bar, menus, Arrangement / Session View, Browser and key map over the same
 * handlers as above (transport on mozart-control, edits on the guarded history paths). */
function ablSetPlaybackMode(next){if(mode===next)return;++transportUiVersion;mode=next;$('#mode').classList.toggle('song',mode==='song');}
function ablTransportActive(){return !!(engine.playing||engine.session?.playing||engine.previewing||engine.playAttempt||stopRequest);}
/** Session ▶: Freestyle has no clip launching, so a pattern clip plays through the existing pattern preview. */
/* Round 3 (owner bug 6): a clip launched before Freestyle can start it (project still loading, a mode switch or stop in
   flight, playback state not read yet) is queued — its launch button blinks like Live's queued clip — and fires the
   moment it can. A newer launch replaces the queued one; nothing is dropped silently. */
// The playback state read (started when the project loaded) is awaited behind the blinking button, instead of inside
// Play — so the launch itself starts without the "Reading playback state" step (abl-launch-queue.js).
const ablLaunchQueue=new LaunchQueue({
 blocked:()=>!engine.ready||engine.loading||modeSwitchPending||!!stopRequest,
 clockUnknown:()=>!engine.previewing&&transportClockUnknown(),
 confirmClock:()=>engine.ensureTransportKnown(),
 exists:patternId=>project.patterns.some(item=>item.id===patternId),
 onChange:patternId=>{try{document.dispatchEvent(new CustomEvent('abl:launch-queued',{detail:{patternId}}));}catch{}},
 start:async(patternId,{isCurrent,queuedMs})=>{
  const again=engine.previewing&&engine.previewPatternId===patternId;
  if(ablTransportActive()){if(await stop()===false)return false;if(again)return true;}
  if(!isCurrent())return false;
  selectPattern(patternId);ablSetPlaybackMode('pattern');const started=await togglePlay();clientLog('abl-clip-launch',{queuedMs});return started;
 },
});
function ablLaunchPattern(patternId){return ablLaunchQueue.launch(patternId);}
/* Freestyle #11 / #14: Session clips are armed ahead of time (previewPattern arm_only, per monitoring peer) and launched as
   layers with ONE pattern_preview_launch at a shared engine time: every track is one launch slot, so clips on several
   tracks play together, a clip launched on a playing track replaces it on the launch quantization step, a track's Stop
   stops only its slot and Stop All Clips stops everything. Without a live peer a clip still plays through the queue above. */
let ablLaunchQuantizeValue=(()=>{try{return normalizeLaunchQuantize(localStorage.getItem('disabelton:launch-quantize'));}catch{return DEFAULT_LAUNCH_QUANTIZE;}})();
function ablSetLaunchQuantize(value){ablLaunchQuantizeValue=normalizeLaunchQuantize(value);try{localStorage.setItem('disabelton:launch-quantize',ablLaunchQuantizeValue);}catch{}toast(`Launch quantization: ${launchQuantizeLabel(ablLaunchQuantizeValue)}`);}
const ablSessionSlot=track=>sessionSlotId({track,laneId:project.cloud?.timelineLaneIds?.[track]||null});
function ablSceneLaunchAvailable(){const host=ablWaveformHost?.(),m=engine.monitor;return !!(engine.ready&&!engine.loading&&host?.capabilities?.sceneLaunch!==false&&host?.dawFetch&&m?.clientId&&m.peer?.connectionState==='connected'&&!readOnlyRefusal());}
function ablSessionLayers(){return engine._patternArm?.layers||new Map();}
function ablSessionChanged(){try{document.dispatchEvent(new CustomEvent('abl:session-layers'));}catch{}}
async function ablLaunchLayers(previews,{stopOthers=false,label='clip'}={}){
 if(!previews?.length){toast('This scene has no MIDI clips to launch.');return false;}
 const started=performance.now();
 try{
  if(engine.previewing){engine.previewing=false;engine.playing=false;}// the single preview stops at the launch time (#14)
  // An explicit launch reopens the receive audio (held silent after a Stop), like Play and key auditions do.
  const launch=engine.patternArm.launch(previews.map(item=>({patternId:item.patternId,slotId:item.slotId})),{quantize:ablLaunchQuantizeValue,stopOthers,beatsPerBar:Number(project?.beatsPerBar)||4});
  try{Promise.resolve(engine.prepareAudition({current:()=>true})).catch(()=>{});}catch{}
  const result=await launch;
  $('#status-message').textContent=`Launched ${label} · ${result.launched.length} clip${result.launched.length===1?'':'s'} · ${launchQuantizeLabel(ablLaunchQuantizeValue)} quantization`;
  clientLog('abl-scene-launch',{label,count:result.launched.length,route:result.route,clickToAckMs:Math.round(performance.now()-started),engineTimeSec:result.engine_time_sec??null});
  return true;
 }catch(error){fail(Object.assign(new Error(`Launch failed: ${error.message}${error.requestId?` (request ${error.requestId})`:''}`),{cause:error}));return false;}
 finally{ablSessionChanged();}
}
/** Session ▶ on a clip. */
function ablLaunchClip(patternId,track){
 if(!ablSceneLaunchAvailable()||!Number.isInteger(track))return ablLaunchPattern(patternId);
 const slotId=ablSessionSlot(track),layer=ablSessionLayers().get(slotId);
 if(layer?.patternId===patternId)return ablStopSessionTrack(track);// Live: the playing clip's ▶ is a ■
 return ablLaunchLayers([{patternId,slotId,track}],{label:'clip'});
}
function ablLaunchScene(scene){return ablLaunchLayers(scene.previews,{stopOthers:true,label:`scene ${scene.index+1}`});}
async function ablStopSessionTrack(track){
 const slotId=ablSessionSlot(track);
 if(ablSessionLayers().has(slotId)){try{await engine.patternArm.stopSlot(slotId);$('#status-message').textContent=ablSessionLayers().size?'Stopped the track’s clip':'Stopped';}catch(error){fail(error);}finally{ablSessionChanged();}return true;}
 if(engine.previewing&&project.clips.some(clip=>clip.track===track&&clip.patternId===engine.previewPatternId))return stop();
 return false;
}
let ablArmTimer=null;
/** Keep every Session pattern clip armed for this peer (at most 16, the engine's per-peer limit) so a launch is one message. */
function ablArmSessionClips(patternIds){clearTimeout(ablArmTimer);ablArmTimer=setTimeout(()=>{if(!ablSceneLaunchAvailable()||engine.pending||engine.inFlight)return;engine.patternArm.armPatterns(patternIds,'session-view').catch(()=>{});},350);}
function ablOpenBrowserTab(tab){if(!tab)return;browserTab=tab;$$('[data-browser]').forEach(x=>{x.classList.toggle('selected',x.dataset.browser===tab);if(x.getAttribute('role')==='tab')x.setAttribute('aria-selected',String(x.dataset.browser===tab));});if(cloudLibrary&&cloudLibrary.view!==cloudLibraryView)cloudLibraryView=null;renderBrowser();}
function ablZoomToRange(start,end){const viewport=$('#arrangement-scroll'),visible=Math.max(40,viewport.clientWidth-PLAYLIST_GUTTER),beats=Math.max(.25,end-start),scale=Math.max(timelineViewport.min,Math.min(timelineViewport.max,visible/(beats/4)*.92));return timelineViewport.setView({scale,scrollLeft:Math.max(0,start/4*scale-visible*.04),scrollTop:viewport.scrollTop});}
const ablShell=installAblShell({...logicShell.api,logicShell,hooks:logicShellHooks,trackOps:ablTrackOps,mainActivator:ablMainActivator,saveVersion:ablSaveVersion,menuItems,openMainMenu,timelineViewport,playlistLayout,playlistLoop,
 selectPattern,openLegacyClipEditor:clip=>{if(clip.patternId){selectPattern(clip.patternId);openEditorPane(editorForPattern(pattern()));}else audioProperties(clip);},
 insertTrack:kind=>openTrackMenu(kind),insertTrackNow:kind=>insertTrackNow(kind),setInsertMarker:beat=>setPlaylistCursor(beat),insertMarkerBeat:()=>editCursorBeat,trackMenuEntries:playlistTrackMenuEntries,insertReturnTrack:()=>window.disabelton.createBus(),renameTrack:row=>renamePlaylistTrack(row),
 openBrowserTab:ablOpenBrowserTab,launchPattern:ablLaunchPattern,launchClip:ablLaunchClip,launchScene:ablLaunchScene,stopSessionTrack:ablStopSessionTrack,armSessionClips:ablArmSessionClips,
 sceneLaunchAvailable:ablSceneLaunchAvailable,launchQuantize:()=>ablLaunchQuantizeValue,setLaunchQuantize:ablSetLaunchQuantize,stopTransport:()=>stop(),transportActive:ablTransportActive,
 ensureArrangementMode:()=>{if(mode==='pattern'&&!ablTransportActive())ablSetPlaybackMode('song');},
 continuePlay:beat=>{if(mode==='pattern'&&!ablTransportActive())ablSetPlaybackMode('song');return togglePlay({startBeat:Number.isFinite(beat)?beat:null});},
 engineState:()=>({previewing:!!engine.previewing,previewPatternId:engine.previewPatternId||null,layers:ablSessionLayers()}),
 zoomToRange:ablZoomToRange,quantize:()=>activeEditor()==='piano'?quantizePianoSelection():toast('Quantize (⌘U): show the clip in the Clip View and select its notes.'),
 toggleAutomation:force=>window.ablAutomation?.toggle?window.ablAutomation.toggle(force):toggleAutomationView(force),
 toggleComputerKeyboard:()=>window.ablMidiKeyboard?.toggle?window.ablMidiKeyboard.toggle():toggleMusicalTyping(),
 typingEnabled:()=>!!window.ablMidiKeyboard?.enabled||typingEnabled,
 toggleLegacyMixer:force=>toggleMixer(force)});
window.vegetableStudio.ablShell=ablShell;
/* Browser Preview (headphone) switch (Freestyle #16): the shell button toggles the library's auto-preview. */
window.disabelton=Object.assign(window.disabelton||{},{browserPreview:()=>cloudLibrary?cloudLibrary.autoPreview!==false:(()=>{try{return localStorage.getItem('disabelton:browser-preview')!=='0';}catch{return true;}})(),setBrowserPreview:on=>{try{localStorage.setItem('disabelton:browser-preview',on?'1':'0');}catch{}if(cloudLibrary){cloudLibrary.setAutoPreview(on);cloudLibrary.render?.();}return !!on;}});
/* Disabelton Clip View (abl-clip-view.js): Live's Detail View over the proven Piano Roll / Step Sequencer.
 * Every write below is the existing edit()/history path (one undo step per call). */
function ablEditNotes(fn){
 activePianoCancel?.();const p=pattern(),id=channel().id,notes=p.notes[id]||[],ids=selectedNotes.size?new Set(selectedNotes):new Set(notes.map(n=>n.id)),result=fn(notes.filter(n=>ids.has(n.id)).map(n=>({...n})),notes);
 if(!result)return false;const changes=new Map((result.changed||[]).map(n=>[n.id,n])),added=result.added||[],removed=new Set(result.removed||[]);if(!changes.size&&!added.length&&!removed.size)return false;
 return edit(()=>{for(const gone of removed)selectedNotes.delete(gone);p.notes[id]=[...notes.filter(n=>!removed.has(n.id)).map(n=>changes.get(n.id)||n),...added];growPatternForNotes(p,[...changes.values(),...added]);if(result.selectAdded&&added.length){clearPianoSelection();added.forEach(n=>selectedNotes.add(n.id));selectedNote=added[0].id;}});
}
/* Disabelton: a full 0–127 stem drag spans the velocity lane's height (abl-clip-view.js sets --abl-vel-k = lane px / 128). */function pianoVelocityLanePx(){const k=Number($('#piano')?.style.getPropertyValue('--abl-vel-k'));return k>0?k*PIANO_VELOCITY_RANGE:PIANO_VELOCITY_RANGE;}
function ablSetPianoSnap(mode){if(!PIANO_SNAP_MODES.some(item=>item.id===mode)||pianoSnapMode===mode)return;activePianoCancel?.();pianoSnapMode=mode;const button=$('#piano-snap'),label=PIANO_SNAP_MODES.find(item=>item.id===mode).label;if(button){button.title=`Snap to grid: ${label}`;button.textContent=mode==='main'?'Smart':label;button.dataset.localSnap=String(mode!=='main');}}
/* Studio API (OAuth) client for region gain/fades; vegetableStudio.studioClientOverride is the integration-test seam. */
function ablStudioClient(){return window.vegetableStudio?.studioClientOverride||(restMixer?.isRestMode===true?restMixer.client:null);}
const ablWaveformOptions=clip=>({buckets:64,clipStartSec:0,clipEndSec:Math.max(.001,clip.length*60/project.bpm)});
const ablClipView=installAblClipView({document,window,
 project:()=>project,pattern,channel,findClip,
 selectChannel:id=>{if(!project.channels.some(c=>c.id===id))return;activePianoCancel?.();const row=rackDisplayRows().find(row=>row.channel?.id===id);selectedChannel=id;if(row){selectedRackRow=row.id;rackSelector?.selection?.focus?.(row.id);}renderRack();renderPiano();},
 selectedNoteIds:()=>[...selectedNotes],editNotes:ablEditNotes,newId:uid,
 addNote:note=>{const p=pattern(),c=channel();const ok=edit(()=>{p.notes[c.id]||=[];p.notes[c.id].push(note);growPatternForNotes(p,[note]);clearPianoSelection();selectedNotes.add(note.id);selectedNote=note.id;pianoCursor=note.start;});if(ok){const audition=pianoNotePreview(c,note.velocity);audition.play(note.pitch);audition.stop();}return ok;},
 deleteNotes:ids=>{const set=new Set(ids);if(!set.size)return false;const p=pattern(),id=channel().id;if(!(p.notes[id]||[]).some(n=>set.has(n.id)))return false;return edit(()=>{p.notes[id]=(p.notes[id]||[]).filter(n=>!set.has(n.id));clearPianoSelection();});},
 duplicateNotes:duplicatePianoNotes,toggleMuteSelection:toggleSelectedNotesMuted,
 quickQuantize:()=>{const pane=$('#piano');if(!pane.classList.contains('hidden'))windows.raise(pane);return quickQuantizePianoStarts();},
 noteVelocityDrag:(event,element)=>{const note=(pattern().notes[channel().id]||[]).find(n=>n.id===element.dataset.note);if(!note)return;activePianoCancel?.();if(!selectedNotes.has(note.id)){clearPianoSelection();selectedNotes.add(note.id);selectedNote=note.id;for(const node of $$('#piano .piano-note[data-note]'))node.classList.toggle('selected',selectedNotes.has(node.dataset.note));}pianoVelocityTool(event,element,note);},
 eraseStroke:event=>pianoStroke(event,{erase:true}),snapBeats:()=>pianoSnap(),clearNoteSelection:()=>{if(!selectedNotes.size||activePianoCancel||engine.interacting)return false;clearPianoSelection();renderPiano();return true;},
 zoomNotes:factor=>{pianoViewport.zoomBy(factor);return true;},renderedNotesTarget:()=>pianoTarget,scrollNotesTo:(top,rowHeight)=>{if(Number.isFinite(rowHeight)&&rowHeight>0&&rowHeight!==pianoRowHeight){applyPianoView({...pianoView(),rowHeight,scrollTop:top});return $('#piano-scroll');}return pianoViewport.setView({scale:pianoBarWidth,scrollLeft:$('#piano-scroll').scrollLeft,scrollTop:top});},splitNotes:()=>restructurePianoNotes('slice'),selectAllNotes:()=>{selectAllPianoNotes();return true;},copyNotes:()=>copyPianoNotes(),pasteNotes:()=>pastePianoNotes({at:pianoCursor}),
 noteMenu:(e,id)=>{e.preventDefault();if(activePianoCancel){if(e.button===2)return;activePianoCancel();}if(id&&!selectedNotes.has(id)){clearPianoSelection();selectedNotes.add(id);selectedNote=id;renderPiano();}const none=!selectedNotes.size;menu(e,[['Cut','⌘X',cutPianoNotes,none],['Copy','⌘C',copyPianoNotes,none],['Paste','⌘V',()=>pastePianoNotes({at:pianoCursor}),!pianoClipboard],['Duplicate','⌘D',duplicatePianoNotes,none],['Delete','⌫',deletePianoSelection,none],null,['Deactivate Note(s)','0',toggleSelectedNotesMuted,none],['Quantize','⌘U',quickQuantizePianoStarts,none],['Split','⌘E',()=>restructurePianoNotes('slice'),none],null,['Note Properties…','',()=>openNoteProperties(selectedNote||[...selectedNotes][0]),none]]);$('#context-menu').dataset.menu='abl-note';},
 scrubRuler:event=>{const prior=pianoTool;if(prior!=='playback')setPianoTool('playback');const started=pianoScrub(event),restore=sample=>{if(sample?.pointerId!==event.pointerId)return;for(const type of ['pointerup','pointercancel'])window.removeEventListener(type,restore);queueMicrotask(()=>{if(pianoTool==='playback'&&prior!=='playback'&&!activePianoCancel)setPianoTool(prior);});};if(!started){if(prior!=='playback')setPianoTool(prior);return false;}for(const type of ['pointerup','pointercancel'])window.addEventListener(type,restore);return true;},
 /* Fold (Live): show only the given key tracks (highest first is derived), or all 128 with null. View-only; the notes keep their pitches. */
 setNoteFold:pitches=>{activePianoCancel?.();setPianoFold(pitches);renderPiano();const scroller=$('#piano-scroll');if(scroller&&pianoFold())scroller.scrollTop=0;return pianoFold();},noteFold:()=>pianoFold(),notePitchAtRow:row=>pianoPitchOfRow(row),
 pianoGeometry:()=>({barWidth:pianoBarWidth,rowHeight:pianoRowHeight}),gestureActive:()=>!!activePianoCancel||!!activeRackCancel||engine.interacting===true,legacyTyping:()=>musicalTypingOpen()?'window':typingEnabled===true?'piano':null,selectNotes:ids=>{clearPianoSelection();for(const id of ids)selectedNotes.add(id);selectedNote=ids[0]??null;renderPiano();},
 setTool:setPianoTool,setSnap:ablSetPianoSnap,setNoteLength:beats=>rememberPianoLength({duration:beats}),
 patternBeats:patternLengthBeats,setPatternBars:(p,bars)=>edit(()=>setPatternLengthBars(p,bars)),renamePattern:(p,name)=>edit(()=>{p.name=name;}),
 openEditor:openEditorPane,closeEditor:closeEditorPane,
 /* Fold velocity lane: one step's velocity, the rack graph's step-velocity write (active steps only), one edit */
 setStepVelocity:(id,index,value)=>{const p=pattern(),before=p?.steps?.[id];if(!Array.isArray(before)||!Number.isInteger(index)||index<0||index>=before.length)return false;if(!rackBaseEditable()||engine.interacting||rackGraph?.busy){toast('Finish the current cloud operation before changing step velocity.');return false;}const steps=before.slice();rackGraphSet(steps,index,value);if(steps[index]===before[index])return false;let applied;try{rackGraphLocalCommit=true;applied=edit(()=>{p.steps[id]=steps;});}finally{rackGraphLocalCommit=false;}return applied;},
 /* Unfolded Drum Rack notes (abl-drum-notes.js): complete pad step rows, the rack stroke commit (adds / draw) and one
  * exact multi-row step edit (delete / move, also across pads) — each ONE edit, one undo step, labelled. */
 drumStepRows:ids=>ids.filter(rackSourceRegistered).map(id=>({channelId:id,steps:rackQueuedSteps(id,pattern().steps[id]||Array(Math.max(16,Math.ceil(patternLengthBeats(pattern())*4))).fill(false))})),
 drumStepRefusal:()=>rackMembershipBusy||rackStepQueue.length||rackStepGesture.active||rackGraph?.busy||engine.interacting?'Finish the current step edit first.':!rackBaseEditable()?'Finish the current cloud operation before editing notes.':null,
 commitDrumStroke:(result,rows,label)=>{const out=rackGestureCommit({...result,label},rows);if(out&&typeof out.catch==='function')out.catch(fail);return out;},
 writeDrumSteps:(next,{label}={})=>{if([...next.keys()].some(id=>!rackSourceRegistered(id))){toast('That pad is not a step row of this clip.');return false;}if(label)engine.patternHistory?.hintLabel?.(label,{kind:'pattern'});const applied=rackEdit(()=>{for(const [id,steps]of next)pattern().steps[id]=steps;});if(!applied&&label)engine.patternHistory?.hintLabel?.(null);return applied;},
 /* Fold grid ⌘←/⌘→ (Pro "Move steps"): the inherited rack rotate, one edit; all=true rotates every step row of the pattern */
 /* Clip View MIDI record take: notes written into the open clip's channel as ONE edit; transport beat for note times */
 transportBeat:()=>Number(engine.beat)||0,transportPlaying:()=>!!engine.playing,
 addTakeNotes:(notes,{linear=false,clipId=null}={})=>{const p=pattern(),c=channel();if(!p||!c||!notes.length)return false;const made=notes.map(n=>({id:uid(),pitch:n.pitch,start:n.start,duration:n.duration,velocity:n.velocity}));return edit(()=>{p.notes[c.id]||=[];p.notes[c.id].push(...made);const grew=growPatternForNotes(p,made);/* a linear take's clip covers the grown pattern (same edit, same undo step) */if(linear&&grew&&clipId!=null){const clip=project.clips.find(item=>item.id===clipId&&item.patternId===p.id);if(clip){/* one pass of the grown pattern (not the old one-bar cycle repeated): the placement's cycle follows the pattern */const placed=linearTakePlacement(clip,patternLengthBeats(p),project.bpm);clip.length=placed.length;clip.cloudRaw=placed.cloudRaw;}}});},
 rotateSteps:(id,delta,{all=false}={})=>rotateRackChannels(all?Object.keys(pattern()?.steps||{}).filter(key=>rackStepRow(key)):[id].filter(key=>key!=null&&rackStepRow(key)),delta),
 auditionNotes:notes=>{const c=channel();for(const n of notes){const audition=pianoNotePreview(c,n.velocity);audition.play(n.pitch);audition.stop();}return notes.length;},
 previewChannel:id=>{const c=project.channels.find(c=>c.id===id);if(!c)return;const audition=pianoNotePreview(c,.8);audition.play(60);audition.stop();},
 startVoice:(current,pitch,velocity)=>typingAudition.startVoice(current,pitch,velocity),keyboardTarget:ablKeyboardTarget,
 dialogOpen:event=>shortcutDialogOpen(event)||$('#context-menu')?.classList.contains('hidden')===false/* an open menu owns the keys */,
 menu:(event,items)=>menu(event,items),
 editAudioClip:(clip,fields)=>edit(()=>Object.assign(clip,fields)),
 waveform:clip=>{if(!clip?.cloudId)return{status:'error',error:'This clip has no Freestyle identity yet.'};const state=clipWaveforms.peek(clip,ablWaveformOptions(clip));return state.status==='ready'?{status:'ready',svg:clipWaveformSvg(state.waveform,{width:1200,height:160})}:state;},
 loadWaveform:clip=>clip?.cloudId?clipWaveforms.load(clip,ablWaveformOptions(clip)):Promise.resolve(),
 ...(ablWaveforms?{showWaveform:(host,clip,range)=>clip?.cloudId?ablWaveforms.showDetail(host,clip,{...range,gain:ablWaveforms.info(clip)?.placement?.gain??1}):'empty'}:{}),
 clipGain:clip=>clip?.cloudId?logicRegionTools.controller.gain(clip.cloudId):null,loadGain:clip=>{if(clip?.cloudId&&ablStudioClient())logicRegionTools.controller.loadGain({cloudId:clip.cloudId});},
 gainAvailable:clip=>!!clip?.cloudId&&!!ablStudioClient(),commitGain:(clip,text,options)=>logicRegionTools.commitGain(clip,text,options),gainContext:clip=>{const client=ablStudioClient();return client&&clip?.cloudId&&clip.laneId?{client,projectId:engine.projectId,clipId:clip.cloudId,laneId:clip.laneId}:null;},
 toast,fail});
window.vegetableStudio.clipView=ablClipView;
/* QA r14 seams (integration tests): the insert marker a take from a stopped transport starts at. */
Object.assign(window.vegetableStudio,{recordStartSec,setInsertMarkerBeat:beat=>setPlaylistCursor(beat),toggleRecord:options=>toggleRecord(options),automationStatus,clearAutomationReadouts});
try{window.vegetableStudio.recordInput=installAblRecordInput({document,window,recorder:engine.recorder});}catch(error){console.warn('record input chooser',error);}
/* LABS / instrument patches (abl-dev-presets.js): Pro's instrument_patch_apply over the open mozart-control channel
 * (this tiny raw-send hook: cloud-monitor's sendControl allowlist has no patch type), saved via engine_set_labs_preset. */
/** The saved preset NAME of lane laneId's plug-in at pluginIndex (getProject lanes[].pluginChain[].preset); null when unknown. */
function savedPluginPreset(raw,laneId,pluginIndex){const lane=(raw?.lanes||[]).find(row=>row?.id===laneId),chain=Array.isArray(lane?.pluginChain)?lane.pluginChain:null;if(!chain)return null;const index=Number.isInteger(pluginIndex)?pluginIndex:0,entry=chain.find(row=>Number(row?.position)===index)??chain[index];return typeof entry?.preset==='string'&&entry.preset?entry.preset:null;}
configureInstrumentPatches({projectId:()=>engine.projectId||'',log:clientLog,
 engineTrackId:laneId=>{const id=Number(project.channels.find(c=>c.laneId===laneId)?.engineTrackId);return Number.isFinite(id)&&id>0?id:null;},
 current:(laneId,plugin)=>{const raw=engine.session?.rawProject,patch=raw?.instrumentPatches?.[laneId];if(typeof patch==='string'&&patch)return patch;if(patch?.name)return String(patch.name);return savedPluginPreset(raw,laneId,plugin?.index);},
 // QA r14: the saved row after an acked channel apply (Freestyle saves lanes[].pluginChain[i].preset itself).
 savedPreset:async({laneId,pluginIndex,patch})=>{const client=ablStudioClient(),projectId=engine.projectId,want=String(patch?.name||'').toLowerCase();if(!client||!projectId)return null;let last=null;for(let attempt=0;attempt<3;attempt++){if(attempt)await new Promise(resolve=>setTimeout(resolve,400));const reply=await client.call('getProject',{path:{project_id:projectId}});if(engine.projectId!==projectId)return null;last=savedPluginPreset(reply?.data?.data??reply?.data,laneId,pluginIndex);if(typeof last==='string'&&last.toLowerCase()===want)return last;}return last;},
 channel:()=>monitorPatchChannel(engine.monitor,engine.projectId),
 // QA r19: right after a reload the monitor peer is still connecting; a patch then waits for it instead of failing.
 status:text=>{const node=$('#status-message');if(node)node.textContent=text;},
 channelConnecting:()=>{const m=engine.monitor;return !!m&&String(m.projectId||'')===String(engine.projectId||'')&&(m.state==='connecting'||m.control?.readyState==='connecting');},
 list:({plugin,family,current})=>listPublishedPatches({client:ablStudioClient(),projectId:engine.projectId,plugin,family,current}),
 persist:async({patch,trackId})=>{const client=ablStudioClient();if(!client||!engine.projectId)throw new Error('Connect the Freestyle Studio API to save the patch.');if(trackId==null)throw new Error('The instrument has no live engine track yet.');return(await client.call('engine_set_labs_preset',{path:{project_id:engine.projectId},body:{instrument_id:String(trackId),preset:patch.name}}))?.data??null;}});
/* Tempo stretch (abl-tempo.js): BPM right-click ▸ Stretch audio with tempo → setProjectTempo stretch_audio job, one Undo step. */
import('./abl-tempo.js').then(({installAblTempo})=>{window.vegetableStudio.ablTempo=installAblTempo({document,studioClient:()=>ablStudioClient(),projectId:()=>engine.ready&&!engine.loading?engine.projectId:null,rawProject:()=>engine.session?.rawProject??null,history:()=>engine.patternHistory,refresh:()=>engine.refresh().then(()=>renderAll()),reloadEngine:detail=>engine.liveReloadRequired?.({...detail,projectId:engine.projectId}),menu,toast,fail,log:clientLog});}).catch(error=>console.warn('tempo stretch',error));
/* Devices lane (abl-engine-tools.js): Separate Stems, the control-bar Scale chooser, device preset seams. */
window.vegetableStudio.ablEngineTools=installAblEngineTools({document,studioClient:()=>ablStudioClient(),projectId:()=>engine.ready&&!engine.loading?engine.projectId:null,rawProject:()=>engine.session?.rawProject??null,history:()=>engine.patternHistory,
 refresh:()=>engine.refresh(),etag:()=>{const tag=engine.session?.rawProject?._studioApi?.etag;return typeof tag==='string'&&tag?tag:null;},reloadEngine:detail=>engine.liveReloadRequired?.({...detail,projectId:engine.projectId}),
 detectTrackId:()=>{const clip=selectedClip?findClip(selectedClip):null;return clip?.cloudId&&!clip.patternId?clip.cloudId:(engine.session?.rawProject?.clips||[]).find(row=>row?.id)?.id??null;},menu,toast,fail,log:clientLog});
