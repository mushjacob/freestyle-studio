import './freestyle-standalone-host.js';
import {syncProjectStepPiano,projectStepPiano,isStepPianoNote} from './step-piano.js';
import {STUDIO_VIEWS,activeStudioView,embeddedInFreestyle,openFreestyleMozart,openFreestyleShare,switchStudioView} from './freestyle-host-actions.js';
import {CloudEngine} from './cloud-engine.js';
import {installLogicShell,logicShellHooks,logicTrackHeaderHtml} from './logic-shell.js';
import {installRegionTools} from './logic-region-tools.js';
import {selectionRange,playRangeDispatch,panicInstrumentIds,sendMidiPanic} from './logic-play-range.js';
import {countInLcd,COUNT_IN_BAR_CHOICES,countInLabel} from './logic-count-in.js';
import {RecordingTakeHistory} from './cloud-recording-persistence.js';
import {TempoAdaptController,installTempoAdapt,tempoStretchMessage} from './logic-tempo-adapt.js';
import {installFreestyleExtras} from './logic-freestyle-extras.js';
import {PatchLibraryController,installPatchLibrary} from './logic-patch-library.js';
import {humanizeNotes,openHumanizeDialog} from './logic-midi-transform.js';
import {AudioImportHistoryController} from './cloud-audio-import-history.js';
import {LaneCreateHistoryController} from './cloud-lane-create-history.js';
import {patternPreviewDiagnostics} from './preview-clock.js';
// Logic labels MIDI 60 as C3; every Piano Roll label goes through this one name.
import {logicNoteName as flNoteName,logicVelocityColor,midiVelocity,LOGIC_TIME_QUANTIZE,timeQuantizeBeats,quantizeLogic,LOGIC_SCALES,LOGIC_SCALE_ROOTS,scaleQuantizeNotes,logicPositionReadout,LOGIC_PIANO_TOOLS,logicPianoTool,logicEffectiveTool,logicPianoContextMenu,pianoRowModel,shiftPitchesByRows,constrainDragAxis} from './logic-piano.js';
import {LOGIC_EDITOR_TABS,registerEditorsApi,editorForPattern,editorWindowId,editorKindForWindow,editorTabsMarkup,clampEditorHeight,defaultEditorHeight,EDITOR_HEIGHT} from './logic-editors.js';
import {LogicMusicalTyping,musicalTypingMarkup,typingCode} from './logic-typing.js';
import {PianoNoteProperties} from './piano-note-properties.js';
import {RackStepGesture} from './rack-step-stroke.js';
import {RackGraphEditor} from './rack-graph-editor.js';
import {RackSelectorController} from './rack-selector-controller.js';
import {rackClipboardCommand,rackSourceBinding,copyRackScore,cutRackScore,pasteRackScore} from './rack-selection.js';
import {CloudRackClipboardWriter} from './cloud-rack-clipboard.js';
import {attachPatternSampleSource,attachPatternSource,serializeCloudPattern,serializeCloudPlacement,setLiveMixOverlay,clearLiveMixOverlays,normalizeCloudProject} from './cloud-session.js';
import {clonePatternForCreate,planChannelClone,applyChannelClone,removeChannelScore} from './rack-clone.js';
import {projectRackView} from './project-rack-view.js';
import {renderMenuHtml,bindMenu,menuKeyDown,MENU_COLUMN} from './context-menu.js';
import {trackHeaderMenuItems,stepRowMenuItems} from './logic-context-menu.js';
import {LOGIC_TOOLS} from './logic-keys.js';
import {matchKeyCommand} from './logic-key-commands.js';
import {logicMainMenus} from './logic-main-menus.js';
import {installTrashlabShell} from './tl-shell.js';
import {valueBox,VALUE_BOX_DRAG_PX} from './fl-value-box.js';
import {fillEachSteps,rotateSteps,advancedFillSteps,randomizeAdvancedFill,patternStepCount,rackRowLength,sameSteps,rackRotateCommand,wheelPoints,wheelStepAt,wheelRotation} from './rack-step-ops.js';
import {emptyRackSourceTemplate,emptyRackSource} from './rack-empty-score.js';
import {buildMixerModel,mixerRowKey} from './mixer-model.js';
import {LiveMixSweep,liveMixSweepRequest,liveMixSweepKey} from './live-mix-sweep.js';
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
import {LaneSendsController,sendSlotMenuItems,sendsUnavailableReason,MAX_LANE_SENDS} from './logic-sends.js';
import {decorateLogicStrips,splitLogicChain,withPendingSlots,logicEqPlugin,logicAutomationModeItems,logicPluginName,openLogicPluginMenu,LOGIC_INSTRUMENT_TYPES,channelStripSettingItems} from './logic-mixer.js';
import {automationHostCandidates,automationClipId,clipDurationSec,automationTargetKey} from './automation-ui.js';
import {mountLogicPluginHeader,programName as logicProgramName} from './logic-plugin-window.js';
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
import {countLabel,playlistCopiesSavedMessage,logicCopy} from './ui-copy.js';
import {TypingPianoAudition} from './typing-piano.js';
import {WebMidiInput} from './web-midi-input.js';
import {PlaylistCloneController,projectPlaylistCloneRead} from './playlist-clone.js';
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
import {PIANO_DEFAULT_BAR_WIDTH,PIANO_ROW_HEIGHT,PIANO_KEY_WIDTH,PIANO_RULER_HEIGHT,PIANO_PITCH_COUNT,PIANO_VELOCITY_RANGE,pianoNoteTop,applyPianoGeometry} from './piano-geometry.js';
import {patternPreviewSvg,patternLengthBeats} from './pattern-preview.js';
import {setPatternLengthBars,growPatternForNotes} from './pattern-length.js';
import {computePlaylistGesture} from './playlist-edits.js';
import {trimPlaylistClipStart,playlistTrimEdge} from './playlist-trim.js';
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
import {WaveformPyramid,restPeaksFetcher} from './waveform-pyramid.js';
import {paintRegionCanvas} from './clip-wave-canvas.js';
import {RecordingRegionView} from './logic-recording-region.js';
import {mountAudioEditor} from './logic-audio-editor.js';
import {NoteTake,takeToRegionNotes,takeLengthBeats,paintTakeNotes,midiCountInPlan} from './logic-note-recorder.js';
import {freestyleHost} from './freestyle-host-transport.js';
import {patternPlaybackAt} from './playback-view.js';
import {CloudLibraryBrowser} from './library-browser.js';
import {LibraryDragDiagnostics} from './library-drag-diagnostics.js';
import {inspectLibraryPreviewError} from './library-preview-error.js';
import {openMixerTools,openPasteChannelStripSheet,MixerToolsController,normalizeLoadedPlugins,expectedPluginFields,NATIVE_PLUGIN_CATALOG} from './mixer-tools.js';
import {fxSlotMenuItems,savedSlotPlugins} from './mixer-fx-slot-menu.js';
import {registerPluginWindow,refreshPluginWindows} from './plugin-window-registry.js';
import {rulerScale,rulerBarMarkup,rulerGridWidths} from './ruler-scale.js';
import {WindowManager} from './window-manager.js';
import {TimelineViewport} from './timeline-viewport.js';
import {PLAYLIST_GUTTER,playlistDropBeat,playlistDropRecord,installPlaylistDragHotspot,playlistGridOrigin,playlistGeometryProbe} from './playlist-geometry.js';
import {clientLog} from './client-diagnostics.js';
import {setLaneRowHint,laneRowHints,replaceLaneRowHints} from './playlist-row-hints.js';
import {playlistTrackMenuItems,laneContents,moveRow,moveRowTo,savedRowOrder,duplicateSettingsBlockReason,duplicateBlockReason,PlaylistTrackActions} from './playlist-track-menu.js';
import {mountStudioIcons} from './studio-icons.js';
import {RemotePluginEditor} from './remote-plugin.js';
import {CloudPluginEditorLifecycle} from './cloud-plugin-editor.js';
import {PluginGuiView,pluginGuiSupported,busPluginGuiSupported,createGuiParameterSync,editorFrameWokenFrom} from './plugin-gui-view.js';
import {pluginHasEditor,editorNotAvailable,NO_EDITOR_MESSAGE} from './plugin-editor-availability.js';
import {EditorFrameStream} from './editor-frame-stream.js';
import {PluginGestureRecorder,cachedGestureSnapshot,readGestureSnapshot,applyGestureChanges,applyGestureChangesGuarded,fastGestureEligible,gestureStepLabel,formatPluginValueText} from './plugin-gesture-history.js';
import {mountPluginEqTab,eqEditsInFlight} from './eq-plugin-tab.js';
import {mountMixerEqSection} from './mixer-eq-section.js';
import {eqSupported} from './eq-editor.js';
import {STUDIO_API_OPERATIONS,StudioApiClient} from './studio-api-client.js';
import {replaceLaneInstrument} from './lane-instrument-replace.js';
import {studioEtag,adoptStudioWrite} from './studio-api-bridge.js';
import {resolvePluginEditorBinding,resolveRestPluginEditorBinding} from './plugin-editor-binding.js';
import {openCloudPanel,getCloudStatus} from './cloud-panel.js';
import {hostFetch,prepareFreestyleMedia,bridgeDiagnostics} from './freestyle-host-transport.js';
import {startEmbeddedStudio} from './freestyle-embed.js';
import {AutomationStore,paintAutomationTracks,createAutomationFromControl,automationHostClip,chooseAutomationHost,laneAutomationWindow,laneVolumeValue,lanePanValue} from './automation-ui.js';
import {automationHostClips,automationHostPlan} from './automation-host-clip.js';
import {PluginInventoryCache,prewarmLaneScopes} from './plugin-inventory-cache.js';
import {BACKING_NOT_EDITABLE} from './backing-lane.js';
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
/* Illogic: edits queued behind a running file import (see queueBehindImport) */const importEditQueue=[];let importDrainTimer=null,importWaitTimer=null,importDraining=false;
let fileDrop=null,laneCreate=null,laneCreateDialog=null,playlistClipboardBusy=false,audioImportBusy=false,audioImportFeedback=null,rackRegistrationBusy=false;
const playlistClipboard=new PlaylistClipboard(),playlistClipboardRecords=[],pendingPlacementIds=new Map();
let lastPlaylistClone=null,playlistClonePending=false;
let restMixer=null,mixerQueue=null,mixRevision=null,mixAdoptTimer=null,shownLiveMix=null,liveMixTimer=null;
let laneSends=null;const laneSendsSupported=()=>['listLaneSends','setLaneSend','deleteLaneSend','createBus','deleteBus'].every(id=>Object.hasOwn(STUDIO_API_OPERATIONS,id));
// FL per-clip audio mute (setClipMuted). Overlay = optimistic/confirmed values until canonical reload.
const audioClipMutes=new AudioClipMuteHistory(),audioClipMuteOverlay=new Map();
const mixerHistoryPending=new Map();/* in-flight mixer Undo/Redo values (optimistic) */
let mixerLastOperation='bus',mixerState=null,mixerPan=null,mixerPanRawState=null,mixerPanReadSequence=0,mixerPanReadRequest=null,mixerMaster=null,mixerMasterRawState=null,mixerMasterReadSequence=0,mixerMasterReadRequest=null,mixerLive=null,mixerRouting=null,mixerRoutingDialog=null,mixerLiveRawState=null,mixerLiveReadSequence=0,mixerLiveReadRequest=null,mixerModelCache=null,mixerModelEpoch=0,mixerView=null,selectedMixerKey=mixerRowKey('bus','master');
let stepPage=0,pianoTarget='',pianoNeedsFocus=true,pianoCursor=0,pianoClipboard=null,pianoGhostsEnabled=true,activePianoCancel=null,noteProperties=null,notePropertiesFrame=null,notePropertiesPreview=null;const selectedNotes=new Set();
const notePropertiesStyles=new Map();
let project, selectedChannel='kick', mixerChannel='master', mode='song', tool='select', pianoTool='select', pianoCommandTool='draw', barWidth=30,playlistLaneHeight=80,playlistZoomPrevious=null,pianoBarWidth=PIANO_DEFAULT_BAR_WIDTH,pianoRowHeight=PIANO_ROW_HEIGHT,pianoZoomPrevious=null,pianoScrubCancel=null,pianoSnapMode='main',pianoSnapMenuCancel=null, selectedClip=null, selectedNote=null, importedTarget=null, recording=false, dirty=false;
document.documentElement.style.setProperty('--piano-bar',`${PIANO_DEFAULT_BAR_WIDTH}px`);
let playlistLoop,playlistNavigator=null,pianoNavigator=null,activePlaylistCancel=null,lastOperationError=null,metronomeRenderKey='',playlistStrokeElement=null,playlistStrokePointer=null;
const playlistStrokeMarkers=new Map(),playlistStrokeVisibility=new Map();
const rackControlWidgets=[];let activeRackKnob=null,rackControlSyncTimer=null;
let activeRackCancel=null,rackStepElement=null,rackStepPointer=null,useBothStepButtons=false;
// FL default: left-click toggles a step (drag paints from the first step's state), right-click clears.
try{useBothStepButtons=localStorage.getItem('illogic:step-mouse-mode')==='both';}catch{}
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
/** An Adapt Project Tempo stretch (or its undo/redo) is running: Freestyle answers timeline writes 409 tempo_stretch_in_progress. */
function tempoAdaptBusy(){return !!window.vegetableStudio?.tempoAdapt?.controller?.busy;}
function tempoAdaptBlocked(action='editing'){if(!tempoAdaptBusy())return false;toast(window.vegetableStudio.tempoAdapt.controller.blockMessage(action));return true;}
function workspaceBusy({ignoreAudioImport=false,ignoreRegionEffects=false,ignoreRestMixer=false,ignorePatternHistory=false,ignoreRackMembership=false,ignoreFileImport=false}={}){if(ignoreFileImport){ignoreAudioImport=true;}return tempoAdaptBusy()||laneMoveBusy||!ignoreRackMembership&&rackMembershipBusy&&!rackMembershipLocalCommit||!!sampleEditor?.busy||!ignoreRegionEffects&&!!regionEffects?.busy||timingMap?.operation?.kind==='write'||rackRegistrationBusy||!ignorePatternHistory&&!!engine.historyPending||!ignorePatternHistory&&!!engine.patternHistory?.busy||!ignoreAudioImport&&audioImportBusy||mixerBusy({ignoreRestMixer})||audioSliceBusy()||playlistClipboardBusy||playlistClonePending||!ignoreFileImport&&!!fileDrop?.busy||!!laneCreate?.busy||!!laneCreateDialog?.busy||audioClipMutes.busy;}
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
 add(!!engine.loading,'project-load');add(!!engine.applying,'edit-save');add(tempoAdaptBusy(),'tempo-adapt');add(!!engine.interacting,'pointer-gesture');
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
/* Region waveforms: one multi-resolution peak cache per clip SOURCE (waveform-pyramid.js). Scroll, zoom,
 * drag and trim repaint synchronously from cached peaks; finer tiles load in the background. */
let wavePaintVersion=0,wavePaintFrame=null,clipDoubleClickAt=0;const wavePreviews=new WeakMap();
const wavePyramid=new WaveformPyramid({fetchPeaks:restPeaksFetcher({apiFetch:(path,init)=>{const host=freestyleHost();if(typeof host?.apiFetch!=='function')throw new Error('Freestyle host unavailable.');return host.apiFetch(path,init);},getProjectId:()=>engine.ready?engine.projectId:null,getTrackId:()=>engine.session?.trackId||null}),onUpdate:()=>{wavePaintVersion++;queueWavePaint();window.illogic?.audioEditor?.repaint?.();}});
{const invalidate=clipWaveforms.invalidate.bind(clipWaveforms);clipWaveforms.invalidate=clipId=>{try{if(clipId)wavePyramid.invalidate(clipId);else for(const id of [...wavePyramid.clips.keys()])wavePyramid.invalidate(id);wavePaintVersion++;}catch{}return invalidate(clipId);};}
function queueWavePaint(){if(wavePaintFrame!==null)return;const raf=globalThis.requestAnimationFrame||(callback=>setTimeout(callback,16));wavePaintFrame=raf(()=>{wavePaintFrame=null;paintClipWaves();});}
/** Synchronous repaint of every audio region canvas in view (cheap when nothing changed: keyed per canvas). */
/* Trashlab: the waveform is the track colour (CSS custom property --tl-wave on the region). */
const regionWaveColors=new WeakMap();function regionWaveColor(element){const lane=element.parentElement;let color=lane&&regionWaveColors.get(lane);if(!color){try{color=getComputedStyle(element).getPropertyValue('--tl-wave').trim();}catch{}color=color||'#b400ff';if(lane)regionWaveColors.set(lane,color);}return color;}
function paintClipWaves(){
 const viewport=$('#arrangement-scroll');if(!viewport||!project)return;
 const view=viewport.getBoundingClientRect();if(!(view.width>0))return;
 const dpr=globalThis.devicePixelRatio||1,bpm=project.bpm||120;
 for(const element of $$('#playlist .audio-clip[data-clip]')){
  const canvas=element.querySelector('canvas.clip-wave-canvas');if(!canvas)continue;
  const clip=findClip(element.dataset.clip);if(!clip?.cloudId)continue;
  const rect=element.getBoundingClientRect();if(rect.bottom<view.top-200||rect.top>view.bottom+200)continue;
  const preview=wavePreviews.get(element),length=preview?.length??clip.length,offset=clip.offsetKnown===false?0:(preview?.offset??clip.offset??0);
  let status='hidden';
  try{status=paintRegionCanvas(canvas,wavePyramid,{clipId:clip.cloudId,offsetBeats:offset,lengthBeats:length,gain:Number.isFinite(Number(clip.volume))?Number(clip.volume):1},{clipLeft:rect.left,clipWidth:rect.width,viewLeft:view.left,viewRight:view.right,height:Math.max(1,element.clientHeight-16)},{bpm,dpr,version:wavePaintVersion,color:regionWaveColor(element),rmsColor:'rgba(0,0,0,0)'});}catch(error){clientLog('clip-wave-paint-error',{message:String(error?.message||error).slice(0,160)});}
  const waiting=status==='empty'&&!canvas.dataset.wavePainted;if(status==='coarse'||status==='exact')canvas.dataset.wavePainted='1';
  const label=element.querySelector('.audio-clip-label');if(label&&label.hidden===waiting)label.hidden=!waiting;
 }
}
function paintPlaylistSelection(){$$('#playlist .clip[data-clip]').forEach(el=>el.classList.toggle('selected',playlistSelection.has(el.dataset.clip)));try{paintAudioEditor();}catch{}playlistNavigator?.refresh();logicShellHooks.selection?.();}
const findClip=id=>allClips().find(c=>c.id===id);
const pattern=()=>project.patterns.find(p=>p.id===project.selectedPattern)||project.patterns[0];
const channel=()=>project.channels.find(c=>c.id===selectedChannel)||project.channels[0];
// Hardware MIDI input (assigned after the typing audition below) and FL's
// Piano roll "preview notes" helper, which is on by default.
let midiInput=null,pianoPreviewNotes=true;
function queueRackControlSync(){if(rackControlSyncTimer!==null)return;rackControlSyncTimer=setTimeout(()=>{rackControlSyncTimer=null;for(const widget of rackControlWidgets)widget.sync();try{syncRackSwing();}catch{}},0);}
function toast(message){queueRackControlSync();/* Illogic: Logic wording (region, Tracks area, Step Sequencer) on every toast */$('#toast').textContent=logicCopy(message);$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3500);$('#status-message').textContent=filePickerFeedbackMessage(playClockReadFeedback(message));}
function fail(e){if(e?.name==='AbortError'||e?.rollbackShown)return;/* 409 tempo_stretch_* (a running/finished Adapt Project Tempo job): Logic wording; follow a running job */{const tempoMessage=e&&typeof e==='object'?tempoStretchMessage(e):null;if(tempoMessage&&String(e.code||'').startsWith('tempo_')){e.message=tempoMessage;if(e.code==='tempo_stretch_in_progress')window.vegetableStudio?.tempoAdapt?.controller?.watch(e.details?.job_id||e.data?.error?.details?.job_id);}}/* a refused save is shown once, by engine.onEditRejected */if(isMixRevisionConflict(e)){e.message=MIX_CONFLICT_NOTICE;noteMixConflict(e);}lastOperationError={message:e.message||String(e),code:e.code||'',status:e.status||'',at:Date.now()};try{clientLog('operation-error',{message:String(lastOperationError.message).slice(0,200),code:lastOperationError.code||null,stack:String(e?.stack||'').split('\n').slice(1,4).join(' | ').slice(0,300)});}catch{}if(historyUiOperation)historyUiOperation.error=lastOperationError.message;if(audioImportFeedback?.active&&audioImportFeedback.scope===JSON.stringify(fileImportScope()))audioImportFeedback.error=lastOperationError.message;const reading=currentPlayClockRead();if(reading)reading.error=lastOperationError.message;console.error(e);toast(lastOperationError.message);}
function checkpoint(){}
function changed(render=true){syncProjectStepPiano(project);audioRangeRevision++;dirty=true;engine.update(project);if(render)renderAll();else renderSummary();}
function edit(fn,render=true){if(tempoAdaptBlocked())return false;if(importEditQueue.length&&!importDraining&&!fileImportInFlight())drainImportQueue();if(workspaceBusy()&&importEditGate()||importEditQueue.length&&!importDraining){/* Logic/FL: an edit made during a file import queues behind it (never refused) */return queueBehindImport('Edit',()=>edit(fn,render));}if(workspaceBusy()){clientLog('edit-refused',{blockers:cloudBlockerReasons().map(reason=>({reason,forMs:Math.round(performance.now()-(cloudBlockerSince.get(reason)??performance.now()))}))});toast('Wait for the cloud operation to finish.');return false;}if(rackClipboardBusy){toast('Wait for the Channel Rack clipboard operation to finish.');return false;}if(rackGraph?.writing&&!rackGraphLocalCommit){toast('Wait for the step velocity edit to finish.');return false;}if(rangeBusy()){toast('Wait for the current audio range request to finish.');return false;}if(sliceBusy()){toast('Wait for the cloud pattern slice to finish.');return false;}if(cloudLibrary?.writeBusy){toast('Wait for the cloud library operation to finish.');return false;}if(engine.editBlocked){toast('Waiting for Freestyle to finish the previous edit…');return false;}if(!engine.ready){toast('Select or create a Freestyle project first.');openCloudPanel().catch(fail);return false;}activePlaylistCancel?.();activePianoCancel?.();if(!rackEditKeepsGesture)activeRackCancel?.();checkpoint();const lengthsBefore=patternLengthsNow();fn();rackViewCache=null;/* edits mutate `project` in place: the identity-keyed rack view must be rebuilt */changed(render);followPatternLengths(lengthsBefore);return true;}
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
 const controller=new PlaylistCloneController({phaseWritable:engine.session.supportsPlacementPhase?.('create')===true,getProject:()=>project,getScope:fileImportScope,flush:()=>engine.flush(),call:(...args)=>engine.session.call(...args),action:(...args)=>engine.session.action(...args),read:async()=>{const scope=fileImportScope(),result=await engine.session.call('get_project',{project_id:scope.projectId});if(JSON.stringify(scope)!==JSON.stringify(fileImportScope()))throw new Error('The project changed while reading Playlist clones.');const saved=projectPlaylistCloneRead(engine,result,scope);engine.session.rawProject=saved.rawProject;engine.session.rawState=saved.rawState;engine.session.project=saved.project;engine.accept(saved.project);},onChange:state=>{lastPlaylistClone=controller;select(state);mixerView?.render();}});
 const history=engine.patternHistory,token=history.beginPlaylistClone(controller);lastPlaylistClone=controller;
 try{const state=await controller.create(options);history.finishPlaylistClone(token);audioRangeRevision++;select(state);renderAll();toast(playlistCopiesSavedMessage(state.ownedPatterns.length+state.ownedAudio.length));return state;}
 catch(error){history.failPlaylistClone(token,error);throw error;}
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
  if(!plan.audioOps.length){const count=Math.max(1,plan.createdIds.length);engine.patternHistory.hintLabel?.(`${action==='duplicate'?'Duplicate':action==='cut'?'Cut':'Paste'} pattern ${count===1?'clip':'clips'}`);if(edit(()=>{project.clips=clone(plan.clips);selectedClip=plan.createdIds[0]||null;})){playlistSelection.sync(project);playlistSelection.select(plan.createdIds);paintPlaylistSelection();toast(action==='cut'?'Playlist clips cut.':'Playlist clips pasted.');}else engine.patternHistory.hintLabel?.(null);return plan;}
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
   if(hasPatterns){project.clips=clone(plan.clips);changed();await engine.flush();record.afterPattern=clone(project.clips);const top=journal?.entries?.[journal.index-1]||null;if(top&&top!==journalTop)patternEntry=top;}
   if(JSON.stringify(fileImportScope())!==scope)throw new Error('The project changed before the audio paste.');for(const op of plan.audioOps){const before=plan.expected.audioClips.find(clip=>clip.cloudId===op.source_id),actual=project.audioClips?.find(clip=>clip.cloudId===op.source_id);if(!before||!actual||['start','length','offset','laneId'].some(key=>before[key]!==actual[key]))throw new Error('The copied audio window changed. Inspect the Playlist before another paste.');}
   timing.mark('sending');await controller.applyBatch(plan.audioOps,{inverseOps:plan.inverseAudioOps});timing.mark('acknowledged');settlePendingAudioOps(ghosts,controller);record.applied=true;record.afterAudio=clone(project.audioClips||[]);
   // QA round 20: a mixed pattern+audio paste is ONE journal step (like a mixed erase).
   const savedBefore=new Set(beforePattern.map(clip=>clip.cloudId).filter(Boolean)),composed=!!patternEntry&&journal?.composeMixedPaste?.({entry:patternEntry,placementIds:project.clips.filter(clip=>clip.cloudId&&!savedBefore.has(clip.cloudId)).map(clip=>clip.cloudId),audioIds:plan.audioOps.filter(op=>op.op==='insert').map(op=>op.id),audioUndo:controller.snapshot().inverseOps,project,label:action==='duplicate'?'Duplicate clips':'Paste clips'})===true;
   // QA round 21: an audio-only paste / ⌘B is one journal step too (same ids on Redo).
   const audioPasteIds=plan.audioOps.filter(op=>op.op==='insert').map(op=>op.id),audioOnlyStep=!hasPatterns&&!composed&&journal?.recordAudioPaste?.({audioIds:audioPasteIds,audioUndo:controller.snapshot().inverseOps,project,label:(action==='duplicate'?'Duplicate ':'Paste ')+(audioPasteIds.length===1?'audio clip':'clips')})===true;
   if(audioOnlyStep)historyJournalObserved();
   clientLog('playlist-clipboard',{action,mixed:hasPatterns,composed,audioOnlyStep});
   if(composed||audioOnlyStep){record.abandoned=true;record.revision=null;++audioRangeRevision;}else{abandonClipboardRedo(record);record.revision=++audioRangeRevision;}playlistSelection.select(plan.createdIds);selectedClip=plan.createdIds[0]||null;renderAll();timing.done(controller);toast('Playlist clips pasted.');return controller.snapshot();
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
  const ghost=showPendingPlaylistClip({track:source.track,beat:op.start_ms*project.bpm/60000},JSON.stringify({name:source.name||'Audio clip',durationSec:op.duration_sec}));if(ghost)ghosts.push({ghost,clipId:op.id});}
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
 const direction=historyUiOperation?.direction||receipt?.direction;
 // FL hint bar: "Undo: <label>" for the step being saved (or the newest press).
 let pending=null;try{pending=direction?engine.patternHistory?.pendingLabel?.(direction):null;}catch{}if(pending?.label)return`${pending.direction==='redo'?'Redo':'Undo'}: ${pending.label}`;
 return direction==='redo'?'Redoing edits in Freestyle…':direction==='undo'?'Undoing edits in Freestyle…':'Applying history in Freestyle…';
}
function renderHistoryControls(){const disabled=!engine.ready||historyFeedbackBusy();for(const selector of ['#undo','#redo','#piano-undo']){const button=$(selector);if(button){button.disabled=disabled;button.setAttribute('aria-busy',String(historyFeedbackBusy()));}}}
function paintHistoryFeedback(){renderHistoryControls();if(historyUiOperation&&historyUiOperation.scope!==JSON.stringify(fileImportScope()))return;if(historyFeedbackBusy()){const message=filePickerFeedbackMessage(historyFeedbackMessage(''));$('#status-message').textContent=message;$('#hint').textContent=message;return;}
 // QA round 30: once no history step is saving any more, FL's hint panel names the step just
 // applied ("Undone: …" / "Redone: …") — also when the press finished while others were still
 // saving (that path painted the pending "Undo: …" and returned). Shown once per applied step.
 // Illogic: the status line never keeps a finished "Undoing edits in Freestyle…" progress message.
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
 if(tempoAdaptBlocked(direction==='redo'?'using Redo':'using Undo'))return Promise.resolve();
 if(historyQueueDepth>=HISTORY_QUEUE_LIMIT){clientLog('undo-queue',{event:'dropped_limit',direction,depth:historyQueueDepth});paintHistoryFeedback();return Promise.resolve();}
 const token=reserveHistoryPress(direction),epoch=historyQueueEpoch,scope=JSON.stringify(fileImportScope()),queuedAt=Date.now();lastHistoryPress={token,epoch};historyQueueDepth++;clientLog('undo-queue',{event:'queued',direction,depth:historyQueueDepth,optimistic:!!token,focus:document.activeElement?.tagName||null,inDialog:!!document.activeElement?.closest?.('dialog[open]')});
 const step=()=>{if(epoch!==historyQueueEpoch||scope!==JSON.stringify(fileImportScope())){clientLog('undo-queue',{event:'cancelled',direction,reason:epoch!==historyQueueEpoch?'earlier_step_failed':'project_changed'});if(token&&engine.patternHistory.reserved?.includes(token))engine.patternHistory.rollbackReserved('cancelled');return;}const before=lastOperationError,started=Date.now(),journal=engine.patternHistory?.snapshot?.();clientLog('undo-queue',{event:'start',direction,waitedMs:started-queuedAt,depth:historyQueueDepth,journal:journal?{hasJournal:journal.hasJournal,canUndo:journal.canUndo,canRedo:journal.canRedo,index:journal.index,entries:journal.entryCount,undoKind:journal.undoKind,redoKind:journal.redoKind,blocked:journal.blocked}:null,workspaceBusy:workspaceBusy()});let owner=null;const run=()=>{owner=historyRouteOwner(direction);return direction==='redo'?redoStep(owner):undoStep(owner);};return Promise.resolve(historyStepWaits()?waitForMixerSaves().then(run):run()).then(()=>{let failed=lastOperationError!==before;if(token&&!token.consumed&&engine.patternHistory.reserved?.includes(token)){engine.patternHistory.rollbackReserved('not_applied');failed=true;}if(!failed)historyRouteApplied(direction,owner);clientLog('undo-queue',{event:failed?'failed':'done',optimistic:!!token,direction,ms:Date.now()-started,error:failed?String(lastOperationError?.message||'').slice(0,240):null,status:String($('#status-message')?.textContent||'').slice(0,160),toast:String($('#toast')?.textContent||'').slice(0,160)});if(failed)historyQueueEpoch++;});};
 const run=(historyQueueDepth===1&&!duplicateQueueDepth?new Promise(resolve=>resolve(step())):Promise.all([historyQueue,duplicateQueue]).then(step)).finally(()=>{historyQueueDepth--;/* Illogic: refresh the status line once the queue drains (no stale progress text) */if(!historyQueueDepth)queueMicrotask(()=>{try{if(!historyFeedbackBusy())paintHistoryFeedback();}catch{}});});
 historyQueue=run.catch(()=>{});return run;
}
// A Mixer gesture, pattern slice, Insert track or other cloud edit released
// just before Cmd+Z is still saving: let it settle (bounded) so it becomes the
// step this Undo reverts instead of a busy refusal (FL queues every press).
// Journaled creations (Insert track, drops/imports, clones) finish first; owners with
// their own receipt history (audio slice, clipboard, region effects) keep their guards.
function historyStepWaits(){return !!(mixerQueue?.busy||restMixer?.busy||sliceBusy()||engine.patternHistory?.externalPending||(engine.patternHistory?.busy&&!engine.historyPending)||laneMoveBusy||laneCreate?.busy||laneCreateDialog?.busy||fileDrop?.busy||audioImportBusy||importEditQueue.length>0||playlistClonePending||historyEditInFlight());}
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
// With no step to apply, ⌘Z / ⇧⌘Z (and the toolbar arrows) say so quietly: it is not an error.
function undo(){if(!historyQueueDepth&&!historyAvailable('undo')){toast('There is nothing to undo.');return Promise.resolve();}return queueHistoryStep('undo');}
function redo(){if(!historyQueueDepth&&!historyAvailable('redo')){toast('There is nothing to redo.');return Promise.resolve();}return queueHistoryStep('redo');}
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
/* The Click button flips at the press (K or a click) and shows the requested state while Freestyle confirms; a refused
 * or failed request puts it back on the confirmed state. */
let metronomeOptimistic=null;
function renderMetronome(){const state=metronomeState(),button=$('#metronome'),availability=uiFeature('metronome'),shown=state.busy&&metronomeOptimistic!==null?metronomeOptimistic:state.actual,key=JSON.stringify([state.actual,shown,state.status,state.busy,state.error,engine.ready,engine.loading,availability.enabled]);if(key===metronomeRenderKey)return;metronomeRenderKey=key;button.classList.toggle('lit',shown===true);button.setAttribute('aria-pressed',shown===null?'mixed':String(shown===true));button.setAttribute('aria-busy',String(!!state.busy));button.dataset.metronomeStatus=state.status||'idle';button.disabled=!!state.busy||!engine.ready||!!engine.loading||!availability.enabled;button.title=!availability.enabled?availability.reason:!engine.ready?'Connect a Freestyle project to use the metronome':state.busy?'Updating metronome in Freestyle…':state.error?`Metronome: ${state.error}`:state.actual===null?'Metronome state is unknown; read and toggle in Freestyle':`Metronome ${state.actual?'on':'off'}`;}
async function toggleMetronomeUi(){if(!engine.ready||engine.loading)return toast('Select or create a Freestyle project first.');if(engine.interacting||engine.applying||rangeBusy()||sliceBusy()||cloudLibrary?.writeBusy)return toast('Finish the current edit before changing the metronome.');try{requireUiFeature('metronome');const before=metronomeState().actual;if(typeof before==='boolean'&&metronomeOptimistic===null)metronomeOptimistic=!before;const pending=engine.toggleMetronome();renderMetronome();const state=await pending;metronomeOptimistic=null;renderMetronome();return state;}catch(error){metronomeOptimistic=null;renderMetronome();fail(error);return null;}}
/* Logic LCD tempo: ↑/↓ and the spinner step ±1 BPM (⇧ ±0.1); typing keeps three decimals. A burst of steps
 * commits ONCE, TEMPO_STEP_IDLE_MS after the last step (or on blur), so KEEP records one history step and
 * ADAPT starts one stretch job instead of one per click. */
const TEMPO_STEP_IDLE_MS=400,TEMPO_STEP_ARM_MS=1500,tempoStep={armedAt:-Infinity,timer:null};
function cancelTempoStep(){if(tempoStep.timer!==null)clearTimeout(tempoStep.timer);tempoStep.timer=null;}
function flushTempoStep(){if(tempoStep.timer===null)return;cancelTempoStep();tempoStep.armedAt=-Infinity;commitTempo(+$('#tempo').value);}
function scheduleTempoStep(){cancelTempoStep();tempoStep.timer=setTimeout(flushTempoStep,TEMPO_STEP_IDLE_MS);}
function stepTempo(direction,fine){const input=$('#tempo');if(!input||input.disabled)return;const base=Number.isFinite(+input.value)&&input.value!==''?+input.value:project.bpm,next=fine?Math.round((base+direction*.1)*10)/10:direction>0?Math.floor(base+1e-9)+1:Math.ceil(base-1e-9)-1;input.value=String(Math.max(+input.min||10,Math.min(+input.max||522,next)));tempoStep.armedAt=Date.now();scheduleTempoStep();}
function renderSummary(){$('#project-title').textContent=project.title;$('#project-summary').textContent=`${countLabel(project.channels.length,'channel')} · ${countLabel(project.patterns.length,'pattern')} · ${countLabel(allClips().length,'clip')}`;if(tempoStep.timer===null)$('#tempo').value=project.bpm;$('#tempo').disabled=project.cloud?.rawProject?.timingMap?.isConstantTempo===false;$('#tempo').title=$('#tempo').disabled?'Tempo map active · Options → Tempo and time signatures':'Tempo (BPM)';document.title=`${project.title} — Trashlab`;renderMetronome();renderHistoryControls();window.vegetableStudio?.tempoAdapt?.paint();}
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
 // A project instrument that is not a row of this pattern yet: the same Step Sequencer row menu, its row commands off with the reason; ours last.
 menu(e,stepRowMenuItems({divider:null,state:{inactive:`${row.model?.name||'This instrument'} is a Freestyle project instrument that is not a row of this pattern yet: choose Use in This Pattern (below) first.`},run:{},
  extras:[{label:'Use in This Pattern',run:()=>activateRackRow(rowId),disabled:!row.model,title:row.model?`Add ${row.model.name||'this instrument'} as a row of this pattern`:'Freestyle has no instrument for this row.'},{label:'Select All',shortcut:'⌘A',run:()=>rackSelector.selectAll()}]}));
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
function rackStepCells(){return $$('.rack-channel .step:not(:disabled)').map(node=>{const bounds=node.getBoundingClientRect();return{channelId:node.closest('.rack-channel').dataset.channel,index:Number(node.dataset.step),left:bounds.left,right:bounds.right,top:bounds.top,bottom:bounds.bottom};});}
/** A gesture's per-cell changes against the rows it started on, so it never
 * writes back a stale whole row (cells it did not touch keep current state). */
// FL: a step toggled off and on again in this session keeps its velocity (its event, pan and pitch are kept by the serializer).
const rackRetiredVelocity=new Map();
function rackGestureChanges(result,initial){const before=new Map((initial||[]).map(row=>[row.channelId,row.steps])),out=[],patternKey=pattern()?.cloudId||pattern()?.id;for(const [id,steps]of result.stepsByChannel){const prior=before.get(id)||[];steps.forEach((value,index)=>{if(!!value===!!prior[index])return;const key=`${patternKey}|${id}|${index}`;if(!value&&typeof prior[index]==='number'&&prior[index]>0){rackRetiredVelocity.delete(key);rackRetiredVelocity.set(key,prior[index]);if(rackRetiredVelocity.size>2048)rackRetiredVelocity.delete(rackRetiredVelocity.keys().next().value);}const kept=value===true?rackRetiredVelocity.get(key):undefined;out.push({rowId:id,index,value:value?(kept??value):false});});}return out;}
function rackSourceRegistered(id){return !!id&&project.channels.some(channel=>channel.id===id&&channel.patternSource&&String(channel.patternId)===String(pattern().id));}
function rackGestureCommit(result){
 const changes=rackGestureChanges(result,rackStepFrozen?.rows);if(!changes.length)return true;
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
  for(const attempt of attempts){const confirmed=rackDisplayRows().find(row=>row.id===attempt.rowId),steps=confirmed?.channel&&pattern().steps[confirmed.channel.id];if(!confirmed?.channel||confirmed.model?.current?.membership?.sourceId!==attempt.source.id||!Array.isArray(steps)||steps.length!==attempt.steps.length||steps.some((value,index)=>(value===true?.85:value)!==(attempt.steps[index]===true?.85:attempt.steps[index])))throw new Error('Freestyle has not confirmed the new channel steps. Reload before trying this row again.');attempt.status='confirmed';}
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
/** Default Pattern Builder step-tap: switching a cell ON plays that channel's sample
 * now over the control channel; OFF is silent, and nothing is layered over a rolling pattern or song. */
function auditionEnabledStep(event,element,wasOn){
 const mode=event.button===2||event.ctrlKey&&/Mac/i.test(navigator.platform)?'off':useBothStepButtons?'on':'toggle';
 if(!(mode==='on'||mode==='toggle'&&!wasOn))return;
 if(engine.playing||engine.previewing||engine.session.playing||engine.playAttempt)return;
 const id=element.closest('.rack-channel')?.dataset.channel,c=project?.channels?.find(channel=>channel.id===id),raw=c?.cloudRaw||{};
 if(!c)return;
 const started=performance.now(),downMs=Number.isFinite(event?.timeStamp)?Math.max(0,started-event.timeStamp):null,done=(route,ok)=>clientLog('step-audition',{route,ok,handlerMs:downMs===null?null:Math.round(downMs*10)/10,responseMs:Math.round(performance.now()-started)});
 if(c.type==='sample'||raw.kind==='sample'||raw.audioFileId||raw.audio_file_id){engine.auditionSampleStep(c).then(result=>done('sample',result!==false),()=>done('sample',false));return;}
 // Software-instrument rows sound too (a short C3 note on the row's instrument through the open control channel).
 if(c.type==='instrument'||c.instrumentType||raw.kind==='plugin'){try{Promise.resolve(engine.preview(c,60)).then(()=>done('instrument',true),()=>done('instrument',false));}catch{done('instrument',false);}}
}
function beginRackStep(event,element){
 // Logic Step Sequencer: left click/drag paints steps; right-click opens the step menu (contextmenu).
 if(activeRackKnob||event.isPrimary===false||rackStepGesture.active||event.button!==0)return;activePlaylistCancel?.();activePianoCancel?.();event.preventDefault();event.stopPropagation();rackStepElement=element;rackStepPointer=event.pointerId;
 clientLog('rack-step-down',{row:element.closest('.rack-channel')?.dataset.channel,step:Number(element.dataset.step),button:event.button,lit:element.classList.contains('on'),membership:rackMembershipBusy,queued:rackStepQueue.length,pending:!!engine.pending,inFlight:!!engine.inFlight});
 rackStepFrozen=null;const stepWasOn=element.classList.contains('on');// a new click always starts from the live rows
 if(!rackStepGesture.start(event)){clientLog('rack-step-dropped',{reason:'gesture-refused',refusal:rackStepEditable()?'scope-or-cells':rackStepRefusal(),step:Number(element.dataset.step)});rackStepElement=null;rackStepPointer=null;engine.interacting=false;return;}
 auditionEnabledStep(event,element,stepWasOn);
 element.setPointerCapture?.(event.pointerId);element.onpointermove=event=>rackStepGesture.move(event);element.onpointerup=event=>rackStepGesture.finish(event);element.onpointercancel=event=>rackStepGesture.pointerCancel(event);element.onlostpointercapture=event=>rackStepGesture.lostPointerCapture(event);
}
function toggleStepMouseButtons(){activeRackCancel?.();useBothStepButtons=!useBothStepButtons;try{localStorage.setItem('illogic:step-mouse-mode',useBothStepButtons?'both':'toggle');}catch{}renderRack();toast(useBothStepButtons?'Step sequencer: left enables, right disables.':'Step sequencer: left click toggles steps.');}
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
 // Keep non-bar children (the cycle overlay) across a re-render.
 const kept=[...ruler.children].filter(child=>!child.classList.contains('ruler-bar'));
 ruler.innerHTML=Array.from({length:bars},(_,index)=>rulerBarMarkup(index,scale,{attribute,subLabels})).join('');ruler.append(...kept);ruler.dataset.rulerScale=key;return true;
}
let pianoRulerBars=16;
/** Piano Roll ruler and grid at the editor's own zoom (called on render and on every zoom). */
function renderPianoRuler(bars=pianoRulerBars){pianoRulerBars=bars;const ruler=$('#piano-ruler');if(ruler)renderBarRuler(ruler,bars,pianoBarWidth,{attribute:'data-piano-beat',subLabels:false,host:$('#piano')});}
/** The header column's own top-left cell: opaque and above the ruler, so the ruler is clipped at the column edge. */
function ensureTimelineCorner(ruler){
 if(document.getElementById('timeline-corner'))return;
 const corner=document.createElement('div');corner.className='timeline-corner';corner.id='timeline-corner';corner.setAttribute('aria-hidden','true');ruler.before(corner);
}
function renderTimelineGeometry(clock=engine.session.positionAt?.()||engine.positionAt?.()||{}){queueMicrotask(()=>{try{paintClipWaves();}catch{}});
 const loopEnd=clock.loopEnabled?(Number(clock.loopEndSec)||0)*(clock.bpm||project.bpm)/60:0,length=Math.max(64,loopEnd,...allClips().map(c=>c.start+c.length)),bars=Math.max(16,Math.ceil(length/4)+4,Math.ceil(Math.max(0,$('#arrangement-scroll').clientWidth-PLAYLIST_GUTTER)/barWidth)+4);
 $('#arrangement').style.width=`calc(${PLAYLIST_GUTTER}px + ${bars} * var(--bar))`;
 // Ruler: bar numbers every 1, 2, 4, 8 ... bars by zoom; beat then division ticks and labels ("5 2", "5 2 3") when zoomed in.
 const ruler=$('#timeline-ruler');ensureTimelineCorner(ruler);renderBarRuler(ruler,bars,barWidth,{host:$('#playlist')});
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
function renderPlaylist(){activePlaylistCancel?.();playlistSelection.sync(project);clipWaveforms.sync(project.audioClips||[]);if(!playlistSelection.has(selectedClip))selectedClip=playlistSelection.ids.values().next().value||null;renderTimelineGeometry();
 const laneCount=Math.max(12,project.cloud?.timelineLaneIds?.length||0,...allClips().map(c=>Number(c.track)+1));$('#track-lanes').innerHTML=Array.from({length:laneCount},(_,track)=>`<div class="track-lane">${logicTrackHeaderHtml({track,name:project.trackNames?.[track]||`Track ${track+1}`,kind:logicTrackKind(track),empty:track>=logicRealTrackCount(),ledOff:playlistTrackLedOff(track)})}<div class="lane-grid" data-track="${track}">${project.clips.filter(c=>c.track===track).map(c=>{const p=project.patterns.find(p=>p.id===c.patternId);if(!p)return '';const color=colors[project.patterns.indexOf(p)%colors.length];return `<div class="clip ${playlistSelection.has(c.id)?'selected':''} ${c.cloudRaw?.muted?'muted-item':''} ${c.pendingLane?'pending-lane':''}" data-clip="${esc(c.id)}" style="left:calc(${c.start/4} * var(--bar));width:calc(${c.length/4} * var(--bar));background:${color};border-color:${color}"><div class="clip-title"><button class="clip-menu-trigger" title="Clip menu" aria-label="Clip menu">▸</button> ${esc(c.name??p.name)}</div>${patternSvg(p,'#2d4844',c)}<div class="clip-resize" title="Trim right edge"></div><div class="clip-trim-start" title="Trim left edge" aria-label="Trim clip start"></div></div>`;}).join('')}${(project.audioClips||[]).filter(c=>c.track===track).map(c=>{const clipMuted=audioClipMuteValue(c.id);return `<div class="clip audio-clip ${playlistSelection.has(c.id)?'selected':''} ${clipMuted===true?'muted-item':''} ${c.cloudRaw?.muted===true?'lane-muted':''}" data-clip="${esc(c.id)}" data-audio="true" data-clip-muted="${clipMuted===null?'unknown':String(clipMuted)}" title="${esc(audioClipMuteTooltip({muted:clipMuted===true}))}" style="left:calc(${c.start/4} * var(--bar));width:calc(${c.length/4} * var(--bar))"><div class="clip-title"><button class="clip-menu-trigger" title="Audio clip menu" aria-label="Audio clip menu">≋</button> ${esc(c.name||'Audio')}</div>${audioWave(c)}<div class="clip-resize" title="Trim right edge"></div><div class="clip-trim-start" title="Trim left edge" aria-label="Trim clip start"></div></div>`;}).join('')}</div></div>`).join('');
 $$('#playlist .lane-grid').forEach(lane=>{/* Logic: right-click / Control-click opens the Tracks menu; it never erases. */lane.oncontextmenu=e=>{if(e.target!==lane)return;e.preventDefault();if(tool!=='zoom')logicShellHooks.tracksMenu?.(e);};lane.onpointerdown=e=>{if(e.isPrimary===false||e.target!==lane)return;if(playlistZoomRequest(e))return playlistZoom(e,lane);if(logicShellHooks.isContextClick?.(e))return;if(tool==='playback'){if(e.button===0)return playlistPlayback(e,lane);if(e.button===2){e.preventDefault();e.stopPropagation();return;}}if(e.button!==0)return;if(e.ctrlKey||e.metaKey||tool==='select')return marqueePlaylist(e,lane);if(tool==='paint'||tool==='draw'&&e.shiftKey)return paintLane(e,lane);if(tool==='draw')return playlistDraw(e,lane);};
 lane.ondragover=e=>{if(!unsupportedPlaylistSampleDrop(e))e.preventDefault();};lane.ondrop=e=>{e.preventDefault();if(unsupportedPlaylistSampleDrop(e)){e.stopPropagation();return;}const pid=e.dataTransfer.getData('application/vegetable-pattern'),p=project.patterns.find(p=>p.id===pid);if(!p)return;const start=playlistDropBeat({clientX:e.clientX,left:playlistGridOrigin(lane),barWidth,snap:e.altKey?0:+$('#snap').value});clientLog('playlist-drop',{...playlistDropRecord({source:'pattern',clientX:e.clientX,left:playlistGridOrigin(lane),barWidth,snap:e.altKey?0:+$('#snap').value,track:+lane.dataset.track,laneId:project.cloud?.timelineLaneIds?.[+lane.dataset.track]||null}),patternId:pid,bpm:project.bpm,geometry:playlistDropGeometry(lane)});edit(()=>project.clips.push({id:uid(),patternId:pid,track:+lane.dataset.track,start,length:patternLengthBeats(p)}));};});
 $$('#playlist .clip[data-clip]').forEach(el=>{el.style.touchAction='none';el.onpointerdown=e=>clipDrag(e,el);el.ondragstart=e=>{e.preventDefault();clipGestureRecord('nativeDragBlocked',{reason:'browser-default',prevented:e.defaultPrevented});};el.ondblclick=()=>{const c=findClip(el.dataset.clip);if(!c)return;if(performance.now()-(clipDoubleClickAt||0)<350)return;clipDoubleClickAt=performance.now();if(c.patternId){selectPattern(c.patternId);/* Logic: a Pattern region opens the Step Sequencer, a MIDI region the Piano Roll */openEditorPane(editorForPattern(pattern()));}else{/* Logic: double-clicking an audio region opens the Audio Track Editor */try{playlistSelection.select([c.id]);}catch{}selectedClip=c.id;paintPlaylistSelection();openEditorPane('audio');}};el.oncontextmenu=e=>{e.preventDefault();e.stopPropagation();/* Logic: right-click / Control-click opens the region menu (Ctrl+Option drag is the zoom gesture). */if(tool==='zoom')return;if(logicShellHooks.regionMenu)logicShellHooks.regionMenu(e,findClip(el.dataset.clip));else playlistClipMenu(e,findClip(el.dataset.clip));};const trigger=el.querySelector('.clip-menu-trigger');trigger.onpointerdown=e=>e.stopPropagation();trigger.onclick=e=>{e.stopPropagation();playlistClipMenu(e,findClip(el.dataset.clip));};});
 $$('#playlist .track-label').forEach(el=>{el.ondblclick=()=>textDialog('Rename Track','Track name',project.trackNames?.[+el.dataset.track]||`Track ${+el.dataset.track+1}`,name=>edit(()=>{project.trackNames||={};project.trackNames[+el.dataset.track]=name;}));el.querySelector('.track-enable').onclick=event=>{const t=+el.dataset.track;
  // Round 24: a track with a saved lane mutes through the same undoable path as the track menu's Mute.
  if(playlistTrackLaneMute(t)!==null){event?.stopPropagation?.();if(!playlistTrackEditable())return toast('Finish the current cloud edit before muting this track.');Promise.resolve().then(()=>togglePlaylistTrackMute(t)).then(syncPlaylistTrackLeds,fail);return;}
  edit(()=>{project.mutedTracks||=[];project.mutedTracks=project.mutedTracks.includes(t)?project.mutedTracks.filter(v=>v!==t):[...project.mutedTracks,t];});};});
 paintAutomationClips();
 // New canvases are painted in this same task from cached peaks (no blank frame after a re-render).
 try{paintClipWaves();}catch{}
 try{if(recordingRegion.active)recordingRegion.paint();}catch{}
 try{paintAudioEditor();}catch{}
 queueCloudWaveforms();
 logicShellHooks.afterTracks?.();paintPendingTracks();
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
/** A region's waveform is a canvas painted from the peak cache; the label shows only until the first peaks exist. */
function audioWave(clip){return`<span class="audio-waveform" style="display:contents"><canvas class="clip-wave-canvas" data-cloud-waveform="canvas" aria-hidden="true"></canvas><div class="audio-clip-label" hidden title="Waveform loads from Freestyle when this clip is visible.">LOADING WAVEFORM</div></span>`;}
function queueCloudWaveforms(delay=0){
 if(delay){clearTimeout(waveformTimer);waveformTimer=setTimeout(()=>{waveformTimer=null;queueCloudWaveforms();},delay);return;}
 if(waveformQueued||clipWaveforms.destroyed)return;waveformQueued=true;Promise.resolve().then(()=>{waveformQueued=false;refreshCloudWaveforms();});
}
function refreshCloudWaveforms(){
 if(clipWaveforms.destroyed||!project)return;
 try{wavePyramid.sync((project.audioClips||[]).map(clip=>clip.cloudId).filter(Boolean));}catch{}
 paintClipWaves();
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
  if(near(control.value,to)){clientLog('plugin-param-history',{index,from,to,open,noop:true});const preview=dialog.controller?.historyPreviewValues;if(preview?.get(index)===to)preview.delete(index);dialog.repaint();dialog.refreshGui?.();return{laneId:controller.target.id,pluginIndex:plugin.index,index,value:to,noop:true};}
  if(!near(control.value,from))throw refused(`${name} is now ${pluginValueText(row,control)}: it changed elsewhere, so this step was not applied.`);
  await controller.parameter(plugin,index,to);if(controller.pluginMutation?.requiresInspection)throw Object.assign(new Error(`Freestyle did not confirm ${name} = ${to}. Inspect the plugin.`),{dispatched:true});
  // The instant preview value stays until the confirmed page read repaints (no flash back).
  // The GUI mirror captures a fresh frame (not a 304) once the window re-read has the new value.
  const settlePreview=()=>{const preview=dialog.controller?.historyPreviewValues;if(preview?.get(index)===to)preview.delete(index);dialog.repaint();dialog.refreshGui?.();};
  // Coalesced re-read of every loaded page: back-to-back ⌘Z/⌘⇧Z settle on the latest step's values.
  if(open&&dialog.isOpen())dialog.controller.refreshParameters({whenIdle:pluginDialogIdle}).then(settlePreview,settlePreview);else settlePreview();clientLog('plugin-param-history',{index,from,to,open});return{laneId:controller.target.id,pluginIndex:plugin.index,index,value:to};
 };
 // FL: the knob shows the restored value at once; the guarded write confirms
 // it, and a refusal/failure reverts the knob (the confirmed read repaints).
 const previewUi=direction=>{const value=direction==='undo'?before:after,controller=dialog.controller;if(!controller||!dialog.isOpen())return null;const preview=controller.historyPreviewValues||=new Map();preview.set(index,value);dialog.repaint();clientLog('plugin-param-history-preview',{index,direction,value});return()=>{if(preview.get(index)===value)preview.delete(index);if(dialog.isOpen())dialog.repaint();};};
 return engine.patternHistory.recordExternalStep({kind:'plugin_parameter',label:`${name} – ${plugin.name||'Plugin'}`,scope,detail:{laneId:c?.laneId??null,pluginIndex:plugin.index,index,paramId,before,after},undo:()=>apply(after,before),redo:()=>apply(before,after),previewUi});
}
/** FL: the new automation clip is selected and scrolled into view. */
function revealSelectedAutomation(){const element=[...document.querySelectorAll('#track-lanes .automation-clip.selected')].at(0);if(!element)return false;try{element.scrollIntoView?.({block:'nearest',inline:'nearest'});}catch{}const row=element.closest('.track-lane,.automation-track'),index=[...($('#track-lanes')?.children||[])].indexOf(row);clientLog('automation-reveal',{key:element.dataset.envelopeKey,inline:element.classList.contains('automation-inline'),row:index});return true;}
function paintAutomationClips(){
 const host=$('#track-lanes');if(!host||!project)return;schedulePluginInventoryPrewarm();const scope=automationScopeKey();
 if(scope&&scope!==automationLoadScope){automationLoadScope=scope;automationStore.bind(project.cloud?.projectId||project.id);automationStore.load({force:true}).catch(error=>{if(error?.code!=='automation_scope_changed')console.warn('[automation] list failed:',error?.message||error);});}
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
function pianoSnapOptions(){return{mainSnap:Number($('#snap').value),gridBeats:.25,beatsPerBar:4};}
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
function playlistEditable(){if(tempoAdaptBlocked())return false;if(workspaceBusy()&&!importEditGate()){toast('Wait for the cloud operation to finish.');return false;}if(rackClipboardBusy){toast('Wait for the Channel Rack clipboard operation to finish.');return false;}if(rackGraph?.writing){toast('Wait for the step velocity edit to finish.');return false;}if(rangeBusy()||sliceBusy()||cloudLibrary?.writeBusy||engine.editBlocked||engine.loading){toast('Wait for the current cloud operation to finish.');return false;}if(!engine.ready){toast('Select or create a Freestyle project first.');openCloudPanel().catch(fail);return false;}return true;}
const playlistStroke=new PlaylistStrokeGesture({getProject:()=>project,getPattern:pattern,getTool:()=>tool,getScope:()=>({projectId:engine.projectId,trackId:engine.session.trackId,load:engine.loadVersion||0,context:engine.session.contextVersion||0,edit:audioRangeRevision,barWidth}),
 pointForEvent:event=>{const bounds=$('#playlist .lane-grid').getBoundingClientRect(),height=$('.track-lane').getBoundingClientRect().height||playlistLaneHeight;return{beat:(event.clientX-bounds.left)/barWidth*4,row:(event.clientY-bounds.top)/height};},
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
 const painter=new ClipGesturePainter({element:marker,initial,origin:{clientX:event.clientX,clientY:event.clientY,pointerId:event.pointerId},pixelsPerBeat:scale/4,rowHeight,isValid:valid,compute:({deltaX,deltaY})=>computePlaylistGesture(initial,{deltaBeats:deltaX/scale*4,deltaTracks:Math.round(deltaY/rowHeight),snapBeats:grid,maxTrack:$$('.track-lane').length-1,bpm:current.bpm})});
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
function playlistPoint(event){const grid=$('#playlist .lane-grid'),bounds=grid?.getBoundingClientRect(),height=$('.track-lane')?.getBoundingClientRect().height||playlistLaneHeight;if(!bounds||!Number.isFinite(event?.clientX)||!Number.isFinite(event?.clientY))throw new Error('The Playlist pointer position is unavailable.');return{beat:Math.max(0,(event.clientX-bounds.left)/barWidth*4),row:Math.max(0,(event.clientY-bounds.top)/height)};}
function playlistView(){const viewport=$('#arrangement-scroll');return{scale:barWidth,rowHeight:playlistLaneHeight,scrollLeft:viewport.scrollLeft,scrollTop:viewport.scrollTop};}
function applyPlaylistView(view){playlistLaneHeight=Math.max(28,Math.min(240,view.rowHeight));document.documentElement.style.setProperty('--lane',`${playlistLaneHeight}px`);timelineViewport.setView(view);syncPlaylistCursorViewport();playlistNavigator?.refresh();queueCloudWaveforms();}
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
 try{if(mode!=='song'||engine.previewing){if(await stop()===false||!current())return false;}setPlaylistCursor(beat);mode='song';$('#mode').classList.add('song');rangePlayback=null;const statusScope=playbackUiScope(),statusVersion=transportUiVersion,playing=engine.play(project,'song',{startSeconds:beat*60/project.bpm});paintTransportBusy();await playing;if(!current())return false;$('#play').classList.add('playing');$('#play').textContent='Ⅱ';$('#status-message').textContent='Playing arrangement from the Playlist cursor';rememberSongPlayingStatus($('#status-message').textContent,statusScope,statusVersion);startTransportFrames();return true;}catch(error){fail(error);return false;}finally{paintTransportBusy();}
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
 activePlaylistCancel?.();e.preventDefault();const current=project,version=engine.loadVersion,initial=playlistSelection.ids,origin={x:e.clientX,y:e.clientY},base=$('#playlist .lane-grid').getBoundingClientRect(),originBeat=(e.clientX-base.left)/barWidth*4,rowHeight=$('.track-lane').getBoundingClientRect().height||playlistLaneHeight,arrangement=$('#arrangement'),bounds=arrangement.getBoundingClientRect(),originRow=(e.clientY-base.top)/rowHeight;
 const marker=document.createElement('div');marker.className='playlist-marquee';marker.setAttribute('aria-hidden','true');arrangement.append(marker);let point={x:e.clientX,y:e.clientY},frame=null,moved=false,finished=false;
 const valid=()=>project===current&&engine.loadVersion===version;
 const paint=()=>{frame=null;if(!valid())return;const liveBounds=arrangement.getBoundingClientRect(),liveBase=$('#playlist .lane-grid').getBoundingClientRect(),originX=origin.x-bounds.left,originY=origin.y-bounds.top,pointX=point.x-liveBounds.left,pointY=point.y-liveBounds.top;marker.style.cssText=`left:${Math.min(originX,pointX)}px;top:${Math.min(originY,pointY)}px;width:${Math.abs(pointX-originX)}px;height:${Math.abs(pointY-originY)}px`;const hits=playlistClipIdsInRect(allClips(),{left:originBeat,right:(point.x-liveBase.left)/barWidth*4,top:originRow,bottom:(point.y-liveBase.top)/rowHeight});playlistSelection.select(initial);playlistSelection.select(hits,{mode:e.shiftKey?'add':'replace'});selectedClip=playlistSelection.ids.values().next().value||null;paintPlaylistSelection();};
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
 const current=project,selected=playlistSelection.has(clip.id),sourceIds=selected?[...playlistSelection.ids]:[clip.id],sourceClips=clone(allClips().filter(item=>sourceIds.includes(item.id))),sourceScope=fileImportScope(),scope=JSON.stringify(sourceScope),scale=barWidth,laneHeight=playlistLaneHeight,rowHeight=element.closest('.track-lane')?.getBoundingClientRect().height||playlistLaneHeight,snapMode=$('#snap').value,snap=event.altKey?0:Number(snapMode),currentTool=tool,editVersion=audioRangeRevision,laneIds=JSON.stringify(project.cloud?.timelineLaneIds||[]),bpm=project.bpm,maxTrack=$$('.track-lane').length-1,patterns=JSON.stringify(project.patterns.filter(pattern=>sourceClips.some(item=>item.patternId===pattern.id))),viewport=$('#arrangement-scroll'),scroll={left:viewport.scrollLeft,top:viewport.scrollTop},origin={clientX:event.clientX,clientY:event.clientY,pointerId:event.pointerId},sourceState=JSON.stringify(sourceClips);
 const valid=()=>project===current&&scope===JSON.stringify(fileImportScope())&&sourceState===JSON.stringify(allClips().filter(item=>sourceIds.includes(item.id)))&&patterns===JSON.stringify(project.patterns.filter(pattern=>sourceClips.some(item=>item.patternId===pattern.id)))&&laneIds===JSON.stringify(project.cloud?.timelineLaneIds||[])&&project.bpm===bpm&&audioRangeRevision===editVersion&&barWidth===scale&&playlistLaneHeight===laneHeight&&$('#snap').value===snapMode&&tool===currentTool&&engine.ready&&!engine.loading&&!engine.editBlocked&&!workspaceBusy()&&!rangeBusy()&&!sliceBusy()&&!cloudLibrary?.writeBusy;
 const originals=new Map($$('#playlist .clip[data-clip]').map(node=>[node.dataset.clip,{node,selected:node.classList.contains('selected')}])),markers=new Map(),host=$('#arrangement'),rulerHeight=$('#timeline-ruler').getBoundingClientRect().height||24;
 if(!sourceClips.length||sourceClips.some(source=>!originals.has(source.id))){engine.interacting=false;toast('Reload the selected Playlist clips before cloning.');return false;}
 for(const source of sourceClips){const original=originals.get(source.id),marker=original.node.cloneNode(true);marker.removeAttribute('data-clip');marker.dataset.previewClip=uid();marker.dataset.sourceClip=source.id;marker.classList.add('playlist-clone-preview');marker.classList.toggle('selected',selected);marker.setAttribute('aria-hidden','true');marker.style.cssText+=`;left:${PLAYLIST_GUTTER+source.start*scale/4}px;top:${rulerHeight+source.track*rowHeight+2}px;width:${source.length*scale/4}px;height:${rowHeight-5}px;bottom:auto;pointer-events:none;opacity:.8;z-index:11`;for(const button of marker.querySelectorAll('button')){button.disabled=true;button.tabIndex=-1;}host.append(marker);markers.set(source.id,marker);}
 for(const {node}of originals.values())node.classList.remove('selected');
 let physical=origin,finished=false,groupSample=null,groupStates=null;
 const contentPoint=sample=>({clientX:sample.clientX+viewport.scrollLeft-scroll.left,clientY:sample.clientY+viewport.scrollTop-scroll.top,pointerId:event.pointerId}),matches=sample=>sample?.pointerId==null||sample.pointerId===event.pointerId;
 const resolve=({deltaX,deltaY})=>{if(!groupSample||groupSample[0]!==deltaX||groupSample[1]!==deltaY){groupSample=[deltaX,deltaY];groupStates=new Map(movePlaylistSelection(sourceClips,new Set(sourceIds),{deltaBeats:deltaX/scale*4,deltaTracks:Math.round(deltaY/rowHeight),snapBeats:snap,maxTrack}).clips.map(item=>[item.id,item]));}return groupStates;};
 const painters=sourceClips.map(source=>new ClipGesturePainter({element:markers.get(source.id),initial:source,origin,pixelsPerBeat:scale/4,rowHeight,threshold:1.5,isValid:valid,compute:delta=>resolve(delta).get(source.id)}));
 const auto=new PlaylistAutoScroll({viewport,pointerId:event.pointerId,getInsets:()=>({left:PLAYLIST_GUTTER,top:rulerHeight}),isValid:valid,onScroll:()=>samplePainters()});auto.update(event,{enabled:false});
 const samplePainters=()=>{if(!valid()){finish(true);return false;}try{const point=contentPoint(physical);painters.forEach(painter=>painter.move(point));return true;}catch(error){finish(true);fail(error);return false;}};
 const finish=(cancel,sample)=>{if(finished||!matches(sample))return;finished=true;auto.destroy();const finalPoint=Number.isFinite(sample?.clientX)&&Number.isFinite(sample?.clientY)?sample:physical;let results;try{results=painters.map(painter=>painter.finish(contentPoint(finalPoint),{cancel}));}catch(error){results=painters.map(painter=>painter.finish(undefined,{cancel:true}));cancel=true;fail(error);}const ghosts=[...markers.values()];for(const {node,selected}of originals.values())node.classList.toggle('selected',selected);if(activePlaylistCancel===cancelGesture){activePlaylistCancel=null;engine.interacting=false;element.onpointermove=element.onpointerup=element.onpointercancel=element.onlostpointercapture=null;try{if(element.hasPointerCapture?.(event.pointerId))element.releasePointerCapture(event.pointerId);}catch{}}
  if(cancel||!results||results.some(result=>result.cancelled)||!valid()){for(const node of ghosts)node.remove();return;}const deltaBeats=results[0].state.start-sourceClips[0].start,deltaTracks=results[0].state.track-sourceClips[0].track;
  // Optimistic copies stay visible (passive) until Freestyle confirms them;
  // a rejected clone removes them and reports the error.
  sourceClips.forEach((source,index)=>{const node=markers.get(source.id),state=results[index]?.state;node.classList.remove('playlist-clone-preview');node.classList.add('playlist-clone-pending');if(state){node.style.left=`${PLAYLIST_GUTTER+state.start*scale/4}px`;node.style.top=`${rulerHeight+state.track*rowHeight+2}px`;}});
  Promise.resolve(playlistCloneAction({sourceIds,deltaBeats,deltaTracks,selectCreated:selected,sourceClips,sourceScope})).catch(fail).finally(()=>{for(const node of ghosts)node.remove();});
 };
 const cancelGesture=Object.assign(()=>finish(true),{pointerId:event.pointerId});activePlaylistCancel=cancelGesture;engine.interacting=true;try{element.setPointerCapture?.(event.pointerId);}catch{}
 element.onpointermove=sample=>{if(!matches(sample)||!Number.isFinite(sample?.clientX)||!Number.isFinite(sample?.clientY))return;physical={clientX:sample.clientX,clientY:sample.clientY,pointerId:event.pointerId};if(samplePainters())auto.update(sample,{enabled:painters.some(painter=>painter.moved)});};element.onpointerup=sample=>finish(false,sample);element.onpointercancel=element.onlostpointercapture=sample=>finish(true,sample);return true;
}
// Bounded interaction evidence only: counters and the last reason/target, no
// clip/project identities, source data, URLs, receipts or restore credentials.
const clipGestureDiagnostics={press:0,started:0,moves:0,release:0,cancel:0,lostCapture:0,nativeDragBlocked:0,queued:0,rejected:0,last:null,surface:null,stream:null,captureLoss:null};
function clipGestureRecord(event,detail={}){if(Object.hasOwn(clipGestureDiagnostics,event)&&typeof clipGestureDiagnostics[event]==='number')clipGestureDiagnostics[event]++;clipGestureDiagnostics.last={event,...detail};}
function clipPointerTarget(event){const target=event.target,tag=String(target?.localName||'').toLowerCase();return{area:target?.closest?.('#playlist')?'playlist':target?.closest?.('#rack')?'rack':target?.closest?.('#mixer')?'mixer':target?.closest?.('#piano')?'piano':'other',hit:target?.closest?.('.clip-menu-trigger')?'clip-menu':target?.closest?.('.clip-resize,.clip-trim-start')?'clip-edge':target?.closest?.('.clip-title')?'clip-title':target?.closest?.('.clip[data-clip]')?'clip-body':target?.closest?.('.playlist-navigator')?'navigator':target?.closest?.('.lane-grid')?'lane-grid':'other',tag:['svg','path','div','span','button','input'].includes(tag)?tag:'other',trusted:event.isTrusted===true,pointer:['mouse','touch','pen'].includes(event.pointerType)?event.pointerType:'unknown'};}
function clipGestureDiagnosticLines(){const d=clipGestureDiagnostics,last=d.last;return[`Playlist gesture gates: ready ${engine.ready}, loading ${!!engine.loading}, applying ${!!engine.applying}, interacting ${!!engine.interacting}, windows dragging ${!!windows.dragging} · CSS cloud-pending ${document.body.classList.contains('cloud-pending')}, cloud-library-writing ${document.body.classList.contains('cloud-library-writing')}, atomic-slice-pending ${document.body.classList.contains('atomic-slice-pending')}`,`Playlist clip gestures: presses ${d.press}, started ${d.started}, moves ${d.moves}, releases ${d.release}, cancel ${d.cancel}, lost ${d.lostCapture}, native drag blocked ${d.nativeDragBlocked}, queued ${d.queued}, rejected ${d.rejected}`,`Playlist pointer target: ${d.surface?`${d.surface.area}/${d.surface.hit}/${d.surface.tag} · trusted ${d.surface.trusted} · ${d.surface.pointer}`:'none'}`,`Playlist clip last: ${last?`${last.event} · ${last.kind||'—'} · ${last.reason||'—'} · default prevented ${last.prevented??'—'} · delta ${last.dx??0},${last.dy??0}`:'none'}`,`Playlist pointer stream: ${d.stream?`${d.stream.type} · pointer ${d.stream.pointerId??'—'}/${d.stream.expected??'—'} · buttons ${d.stream.buttons??'—'} · delta ${d.stream.dx??0},${d.stream.dy??0} · ${d.stream.target.area}/${d.stream.target.hit}/${d.stream.target.tag}`:'none'}`,`Playlist capture loss: ${d.captureLoss?`pointer ${d.captureLoss.pointerId??'—'}/${d.captureLoss.expected??'—'} · buttons ${d.captureLoss.buttons??'—'} · own target ${d.captureLoss.owned} · connected ${d.captureLoss.connected} · has capture ${d.captureLoss.captured} · ${d.captureLoss.target.area}/${d.captureLoss.target.hit}/${d.captureLoss.target.tag}`:'none'}`];}
const PLAYLIST_NO_TRIM_TOOLS=new Set(['zoom','playback','mute','erase','slice']);
/** FL ~8 px edge zones decide trim vs move from geometry, not a thin handle element. */
function clipEdgeAt(event,el){if(event.target?.closest?.('.clip-menu-trigger'))return null;if(event.target?.classList?.contains('clip-trim-start'))return 'start';if(event.target?.classList?.contains('clip-resize'))return 'end';const rect=el.getBoundingClientRect();return playlistTrimEdge({clientX:event.clientX,left:rect.left,right:rect.right});}
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
  if(c.patternId)return slicePatternPlacement(c,beat).catch(fail);
  return sliceAudioClip(c,beat).catch(fail);
 }
 // Match Draw/clone: capture Alt's unsnap policy once for this whole gesture.
 const gestureSnap=e.altKey?0:+$('#snap').value;
 const trimmingStart=edge==='start',resizing=!!edge,slipping=tool==='slip'&&!resizing;
 // Logic: Option-drag copies regions (Shift-drag clone kept from the FL layer).
 if((e.altKey||e.shiftKey)&&!e.ctrlKey&&!e.metaKey&&!resizing&&!slipping)return playlistCloneDrag(e,el,c);
 // Own the accepted gesture, as Draw/clone already do. Browser-native drag
 // defaults can cancel pointer delivery before our release-only commit.
 e.preventDefault();
 if(!playlistSelection.has(c.id))playlistSelection.select([c.id]);selectedClip=c.id;paintPlaylistSelection();
 const current=project,version=engine.loadVersion,startX=e.clientX,startY=e.clientY,old={...c},rowHeight=el.closest('.track-lane')?.getBoundingClientRect().height||playlistLaneHeight,maxTrack=$$('.track-lane').length-1,initial=allClips(),selected=playlistSelection.ids;
 const context={projectId:engine.projectId,trackId:engine.session.trackId,version:engine.session.contextVersion||0,edit:audioRangeRevision},invalidReason=()=>project!==current?'project-replaced':engine.loadVersion!==version?'load-changed':engine.projectId!==context.projectId?'project-changed':engine.session.trackId!==context.trackId?'take-changed':(engine.session.contextVersion||0)!==context.version?'context-changed':audioRangeRevision!==context.edit?'edit-revision-changed':!engine.ready?'not-ready':engine.loading?'loading':engine.editBlocked?'applying':workspaceBusy()&&!importEditGate()?'workspace-busy':rangeBusy()?'range-busy':sliceBusy()?'slice-busy':cloudLibrary?.writeBusy?'library-busy':null,valid=()=>!invalidReason();
 const group=resizing&&!trimmingStart?[c]:initial.filter(clip=>selected.has(clip.id));engine.interacting=true;try{el.setPointerCapture(e.pointerId);}catch{engine.interacting=false;clipGestureRecord('rejected',{reason:'capture-failed'});return;}const gestureKind=slipping?'slip':trimmingStart?'start-trim':resizing?'end-trim':'move';clipGestureRecord('started',{kind:gestureKind,reason:'captured',prevented:e.defaultPrevented});
 const viewport=$('#arrangement-scroll'),initialScroll={left:viewport.scrollLeft,top:viewport.scrollTop};let physicalPoint={clientX:startX,clientY:startY,pointerId:e.pointerId};const contentSample=event=>({...event,clientX:event.clientX+viewport.scrollLeft-initialScroll.left,clientY:event.clientY+viewport.scrollTop-initialScroll.top,pointerId:e.pointerId});
 let groupSample=null,groupStates=null;const resolveGroup=({deltaX,deltaY})=>{const snap=gestureSnap,key=[deltaX,trimmingStart||slipping?0:deltaY,barWidth,snap];if(!groupSample||key.some((value,index)=>value!==groupSample[index])){
  let states;
  if(trimmingStart){const requested=snap>0?Math.round(deltaX/barWidth*4/snap)*snap:deltaX/barWidth*4,trim=(clip,delta)=>trimPlaylistClipStart(clip,{deltaBeats:delta,snapBeats:0,bpm:current.bpm,pattern:current.patterns.find(pattern=>pattern.id===clip.patternId)}),candidates=group.map(clip=>trim(clip,requested)),deltas=candidates.map((clip,index)=>clip.start-group[index].start),shared=requested>=0?Math.min(requested,...deltas):Math.max(requested,...deltas);states=group.map(clip=>trim(clip,shared));}
  else if(slipping){const requested=snap>0?Math.round(deltaX/barWidth*4/snap)*snap:deltaX/barWidth*4,slip=(clip,delta)=>slipPlaylistClipContents(clip,{deltaBeats:delta,snapBeats:0,bpm:current.bpm,pattern:current.patterns.find(pattern=>pattern.id===clip.patternId)}),candidates=group.map(clip=>slip(clip,requested)),audioDeltas=candidates.flatMap((clip,index)=>clip.patternId?[]:[group[index].offset-clip.offset]),shared=requested>=0?Math.min(requested,...audioDeltas):Math.max(requested,...audioDeltas);states=group.map(clip=>slip(clip,shared));}
  else states=movePlaylistSelection(initial,selected,{deltaBeats:deltaX/barWidth*4,deltaTracks:Math.round(deltaY/rowHeight),snapBeats:snap,maxTrack}).clips;
  // Resolve and validate the whole group before publishing preview or commit.
  const resolved=new Map(states.map(clip=>[clip.id,clip]));groupStates=resolved;groupSample=key;
 }return groupStates;};
 const clipElements=new Map($$('#playlist .clip[data-clip]').map(node=>[node.dataset.clip,node]));
 const painters=group.map(clip=>{const element=clipElements.get(clip.id),svg=element.querySelector(clip.patternId?'.pattern-preview-svg':'[data-cloud-waveform]'),originalMarkup=svg?.outerHTML,originalTransform=svg?.style.transform||'';return new ClipGesturePainter({element,onPaint:clip.patternId?null:next=>{if(next)wavePreviews.set(element,{length:next.length,offset:next.offset});else wavePreviews.delete(element);paintClipWaves();},initial:clip,origin:{clientX:startX,clientY:startY,pointerId:e.pointerId},pixelsPerBeat:barWidth/4,rowHeight,resize:resizing,resizeStart:trimmingStart,slip:slipping,paintSlip:next=>{const target=element.querySelector(clip.patternId?'.pattern-preview-svg':'[data-cloud-waveform]');if(!target)return;if(clip.patternId){const markup=patternSvg(current.patterns.find(pattern=>pattern.id===clip.patternId),'#2d4844',next);if(target.outerHTML!==markup)target.outerHTML=markup;}else target.style.transform=`translateX(${(clip.offset-next.offset)*barWidth/4}px)`;},restoreSlip:()=>{const target=element.querySelector(clip.patternId?'.pattern-preview-svg':'[data-cloud-waveform]');if(!target)return;if(clip.patternId&&originalMarkup)target.outerHTML=originalMarkup;else target.style.transform=originalTransform;},threshold:1.5,isValid:valid,compute:delta=>resizing&&!trimmingStart?computePlaylistGesture(old,{deltaBeats:delta.deltaX/barWidth*4,deltaTracks:0,snapBeats:gestureSnap,resize:true,maxTrack,bpm:current.bpm}):resolveGroup(delta).get(clip.id)});});
 const samplePainters=()=>{const sample=contentSample(physicalPoint);try{if((trimmingStart||slipping)&&(painters.some(painter=>painter.moved)||Math.hypot(sample.clientX-startX,sample.clientY-startY)>=1.5))resolveGroup({deltaX:sample.clientX-startX,deltaY:0});painters.forEach(painter=>painter.move(sample));return true;}catch(error){finish(true);fail(error);return false;}};
 const autoscroll=new PlaylistAutoScroll({viewport,pointerId:e.pointerId,getInsets:()=>({left:PLAYLIST_GUTTER,top:$('#timeline-ruler').getBoundingClientRect().height||24}),isValid:valid,onScroll:samplePainters});autoscroll.update(e,{enabled:false});
 const recordStream=event=>{clipGestureDiagnostics.stream={type:event.type||'unknown',pointerId:Number.isInteger(event.pointerId)?event.pointerId:null,expected:e.pointerId,buttons:Number.isInteger(event.buttons)?event.buttons:null,dx:Number.isFinite(event.clientX)?Math.round(event.clientX-startX):null,dy:Number.isFinite(event.clientY)?Math.round(event.clientY-startY):null,target:clipPointerTarget(event)};};
 const movePointer=event=>{recordStream(event);if(event.pointerId!=null&&event.pointerId!==e.pointerId||!Number.isFinite(event.clientX)||!Number.isFinite(event.clientY))return;physicalPoint={clientX:event.clientX,clientY:event.clientY,pointerId:e.pointerId};clipGestureRecord('moves',{kind:gestureKind,reason:invalidReason()||'sample',dx:Math.round(event.clientX-startX),dy:Math.round(event.clientY-startY)});if(samplePainters())autoscroll.update(event,{enabled:painters.some(painter=>painter.moved)});};
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
 const releasePointer=event=>{recordStream(event);finish(false,event);},cancelPointer=event=>{recordStream(event);finish(true,event,'pointercancel');};
 activePlaylistCancel=Object.assign(()=>finish(true),{pointerId:e.pointerId});document.addEventListener('pointermove',movePointer,true);document.addEventListener('pointerup',releasePointer,true);document.addEventListener('pointercancel',cancelPointer,true);el.onlostpointercapture=event=>{if(event?.pointerId!=null&&event.pointerId!==e.pointerId)return;clipGestureDiagnostics.captureLoss={pointerId:Number.isInteger(event?.pointerId)?event.pointerId:null,expected:e.pointerId,buttons:Number.isInteger(event?.buttons)?event.buttons:null,owned:!event?.target||event.target===el,connected:el.isConnected,captured:!!el.hasPointerCapture?.(e.pointerId),target:clipPointerTarget(event||{})};if(event?.target&&event.target!==el)return;clipGestureDiagnostics.lostCapture++;finish(true,event,'lostpointercapture');};
}
/** Edit ▸ Convert ▸ Regions to New Regions (⌥⌘R): the region gets its own copy of its pattern.
 * ONE history step on a Studio API project (it used to save through the model diff, which records no Undo step for
 * "new pattern + re-pointed region"): createPattern (the copy) + updatePatternPlacement {patternId}. ⌘Z points the
 * region back and deletes the copy while it is untouched; ⇧⌘Z restores the copy (same ID) and re-points the region.
 * Every write follows a fresh read and never overwrites newer data. */
let makeUniquePending=false;
async function makeUnique(id){
 const clip=project.clips.find(item=>item.id===id),source=clip&&project.patterns.find(item=>item.id===clip.patternId);
 if(!clip||!source){toast('Select a MIDI or pattern region first.');return null;}
 const copyName=()=>{const taken=new Set(project.patterns.map(item=>item.name));let name=`${source.name} #2`;for(let n=3;taken.has(name);n++)name=`${source.name} #${n}`;return name;};
 if(engine.session.rawState?.studioApi!==true||!clip.cloudId||!(source.cloudId||source.cloudRaw)){const name=copyName();return edit(()=>{const c=project.clips.find(item=>item.id===id),p=clone(project.patterns.find(item=>item.id===c.patternId));p.id=uid();p.name=name;project.patterns.push(p);c.patternId=p.id;project.selectedPattern=p.id;});}
 if(makeUniquePending||regionCreatePending||!engine.ready||engine.loading||engine.applying||engine.interacting||activePlaylistCancel||activePianoCancel||activeRackCancel||workspaceBusy()||rangeBusy()||sliceBusy()||engine.patternHistory?.externalPending){toast('Finish the current edit before converting the region.');return null;}
 const history=engine.patternHistory,label='Convert to New Region';makeUniquePending=true;let pending=null;
 try{
  await engine.flush();const scope=fileImportScope(),options=extra=>({refresh:false,expectedContext:{projectId:scope.projectId,trackId:scope.trackId,contextVersion:engine.session.contextVersion||0},idempotencyKey:regionKey(),...extra});
  const placementId=clip.cloudId,fromId=source.cloudId||source.id,name=copyName(),local={...clone(source),id:'local-'+uid(),name},dto=serializeCloudPattern(local,{...project,patterns:[...project.patterns,local]});
  let copyId=null,copyEvents=null;
  const point=async patternId=>{const raw=await savedRaw(),row=raw.placements.find(item=>item.id===placementId);if(!row)throw regionError('That region is no longer saved.',{dispatched:false});
   await engine.session.action('update_pattern_placement',{placement_id:placementId,placement:{busId:row.busId||'master',patternId}},options({ifMatch:JSON.stringify(raw.timelineRevision)}));};
  const confirm=async expected=>{const raw=await savedRaw(),row=raw.placements.find(item=>item.id===placementId);if(row?.patternId!==expected)throw regionError('Freestyle has not confirmed the converted region.',{operationUncertain:true});return raw;};
  pending=history.beginExternalStep({kind:'pattern_region_convert',label});
  const made=regionBody(await engine.session.action('create_pattern',{pattern:dto},options()));copyId=made?.pattern?.id||made?.patternId||made?.pattern_id||made?.id;if(!copyId)throw regionError('Freestyle created the copy without returning its ID. Reload the project to inspect it.',{operationUncertain:true});
  await point(copyId);{const raw=await confirm(copyId);copyEvents=JSON.stringify(raw.patterns.find(row=>row.id===copyId)?.pattern?.events||[]);}
  // Undo: only while the copy is exactly as created and only this region uses it; anything newer refuses (nothing sent).
  const undo=async()=>{const raw=await savedRaw(),copy=raw.patterns.find(row=>row.id===copyId),row=raw.placements.find(item=>item.id===placementId);
   if(!copy||!row||row.patternId!==copyId||!raw.patterns.some(item=>item.id===fromId)||JSON.stringify(copy.pattern?.events||[])!==copyEvents||raw.placements.some(item=>item.patternId===copyId&&item.id!==placementId))throw regionError('That region or its new pattern changed after the conversion. Undo will not overwrite newer data.',{dispatched:false});
   await point(fromId);await savedRaw();await engine.session.action('delete_pattern',{pattern_id:copyId},options({confirmedDestructive:true}));await confirm(fromId);renderAll();return{placementId,patternId:fromId};};
  const redo=async()=>{const raw=await savedRaw(),row=raw.placements.find(item=>item.id===placementId);if(!row||row.patternId!==fromId||raw.patterns.some(item=>item.id===copyId))throw regionError('The region changed since the conversion was undone. Redo will not overwrite newer data.',{dispatched:false});
   await engine.session.action('restore_pattern',{pattern_id:copyId},options());await point(copyId);await confirm(copyId);renderAll();return{placementId,patternId:copyId};};
  history.finishExternalStep(pending,{undo,redo,detail:{placementId,fromPatternId:fromId,patternId:copyId}});pending=null;
  const uiPattern=project.patterns.find(row=>row.cloudId===copyId||row.id===copyId);if(uiPattern)selectPattern(uiPattern.id);else renderAll();
  toast(`Region converted to a new region (${name}).`);return{patternId:uiPattern?.id??copyId,clipId:id};
 }catch(error){if(pending)history.failExternalStep(pending,error);fail(error);return null;}finally{makeUniquePending=false;}
}
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
/** Status after a confirmed bus save, from BusResult.liveEngine (API 357: create/update/delete apply to the open session). */
function busLiveStatusText(receipt){
 const live=receipt?.liveEngine??receipt?.live_engine??receipt?.response?.liveEngine??null;
 if(live?.applied===true)return'Bus settings saved and applied to the open session.';
 if(live?.applied===false)return live.reason==='no_live_session'?'Bus settings saved. No Freestyle session is open; the next session load plays them.':`Bus settings saved, but the open session did not take them live (${live.reason==='engine_rejected'?'the engine refused the change':live.reason==='engine_unreachable'?'the engine could not be reached':'no reason given'}). Reload the project to hear them.`;
 return'Bus settings saved.';
}
async function openBusSettings(){
 if(!engine.ready)return openCloudPanel();if(!directLevelEditable()||engine.interacting)return toast('Finish the current cloud edit before opening buses.');await engine.flush();await mixerState.refresh();
 const busScope=JSON.stringify([engine.projectId,engine.session.trackId,engine.loadVersion||0,engine.session.contextVersion||0]),assertBusDialog=()=>{if(JSON.stringify([engine.projectId,engine.session.trackId,engine.loadVersion||0,engine.session.contextVersion||0])!==busScope)throw new Error('The cloud project changed. Reopen the bus settings.');};const d=dialog('Mixer buses','<p>Project buses. Freestyle applies a created, changed or deleted bus to the open session at once (Studio API 357).</p><label>Bus<select class="bus-choice"></select></label><label>Name<input class="bus-name" maxlength="255"></label><label>Volume (%)<input class="bus-gain" type="number" min="0" max="400" step="1" placeholder="Not reported"></label><label><input class="bus-mute" type="checkbox"> Muted</label><label><input class="bus-solo" type="checkbox"> Solo</label><p class="bus-state" role="status"></p><button class="bus-inspect">Reload buses</button><button class="primary bus-save">Create bus</button>');
 let selected=null,newId=crypto.randomUUID(),dirtyFields=new Set(),busy=false;const recoveryBlocked=()=>{const state=mixerState.snapshot();return state.records.some(entry=>JSON.stringify(entry.scope)===JSON.stringify(state.scope)&&['uncertain','saved_unconfirmed','rejected'].includes(entry.status)&&!entry.inspectedRead);};const unlock=()=>{const master=selected==='master';for(const input of d.querySelectorAll('input'))input.disabled=master||busy;choice.disabled=busy;save.disabled=master||busy||recoveryBlocked();};const choice=d.querySelector('.bus-choice'),status=d.querySelector('.bus-state'),save=d.querySelector('.bus-save');
 const populate=()=>{const snapshot=mixerState.snapshot();choice.innerHTML='<option value="">New bus</option>'+((snapshot.buses||[]).map(bus=>`<option value="${esc(bus.id??bus.bus_id)}">${esc(bus.name||bus.id||bus.bus_id)}</option>`).join(''));choice.value=selected||'';paint();};
 const paint=()=>{const bus=mixerState.snapshot().buses?.find(bus=>(bus.id??bus.bus_id)===selected),master=selected==='master';d.querySelector('.bus-name').value=typeof bus?.name==='string'?bus.name:'';d.querySelector('.bus-gain').value=typeof bus?.gain==='number'?String(bus.gain*100):'';for(const [selector,key]of [['.bus-mute','muted'],['.bus-solo','soloed']]){const input=d.querySelector(selector);input.checked=bus?.[key]===true;input.indeterminate=!!selected&&typeof bus?.[key]!=='boolean';}dirtyFields.clear();save.textContent=selected?'Save bus':'Create bus';save.disabled=master||busy||recoveryBlocked();for(const input of d.querySelectorAll('input'))input.disabled=master||busy;status.textContent=master?'The master bus is read-only.':'';};
 choice.onchange=()=>{selected=choice.value||null;paint();};for(const [selector,key]of [['.bus-name','name'],['.bus-gain','gain'],['.bus-mute','muted'],['.bus-solo','soloed']])d.querySelector(selector).oninput=()=>dirtyFields.add(key);
 d.querySelector('.bus-inspect').onclick=async()=>{try{assertBusDialog();busy=true;save.disabled=true;await mixerState.refresh();populate();status.textContent='Saved buses reloaded.';}catch(error){status.textContent=error.message;}finally{busy=false;unlock();}};
 save.onclick=async()=>{if(busy)return;try{assertBusDialog();assertRangeIdle();if(recoveryBlocked())throw new Error('Reload the saved buses to inspect the previous result before another edit.');}catch(error){status.textContent=error.message;return;}busy=true;save.disabled=true;choice.disabled=true;const request={bus_id:selected||newId};for(const field of dirtyFields){if(field==='name')request.name=d.querySelector('.bus-name').value;if(field==='gain'){const value=d.querySelector('.bus-gain').value;if(value===''){status.textContent='Enter a volume before saving it.';busy=false;save.disabled=false;choice.disabled=false;return;}request.gain=Number(value)/100;}if(field==='muted')request.muted=d.querySelector('.bus-mute').checked;if(field==='soloed')request.soloed=d.querySelector('.bus-solo').checked;}
  try{const result=await mixerState[selected?'updateBus':'createBus'](request);selected=request.bus_id;selectedMixerKey=mixerRowKey('bus',selected);mixerChannel=selected;newId=crypto.randomUUID();populate();renderMixer();status.textContent=result?.noop?'No bus setting changed.':busLiveStatusText(result?.receipt?.receipt);}catch(error){status.textContent=error.message;}finally{busy=false;unlock();}
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
 if(target.kind!=='lane'&&!(target.kind==='bus'&&control==='pan')||!MIXER_HISTORY_CONTROLS.has(control)||before===undefined||before===null||sameMixerValue(before,after))return;
 const scope=engine.patternHistory.context();
 saved.then(()=>{
  const apply=async(from,to)=>{
   // QA round 25: the strip and the Playlist LED show the step's value when ⌘Z/⌘⇧Z is pressed
   // (optimistic), before the save; a refusal puts the previous value back.
   const change={target,control,value:to};showMixerPending([change]);
   try{const result=await restMixer.setControl(target,control,to,{expected:from});holdMixerValues([change]);const row=currentMixerModel().rows.find(item=>item.key===rowKey);if(row)sendLiveMixerFinal(row,control,to);mixerChanged();scheduleMixerRefresh();return{target,control,value:to,status:result.receipt?.status??null};}
   catch(error){if(error?.studioMixerReceipt?.attempted===false||['studio_mixer_busy','studio_mixer_scope_changed','studio_mixer_history_conflict'].includes(error?.code))error.dispatched=false;if(isMixRevisionConflict(error)){error.historyNotApplied=true;noteMixConflict(error);}rollbackMixerPending([change],[{target,control,value:from}],error);throw error;}
  };
  engine.patternHistory.recordExternalStep({kind:'mixer',label:label||'Mixer',scope,detail:{laneId:target.id,control,before,after},cascade:mixerCascade([{target,control,value:after,before}]),undo:()=>apply(after,before),redo:()=>apply(before,after)});
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
function mixerChanged(){mixerModelEpoch++;if(restMixer?.isRestMode&&!restMixer.busy&&!engine.interacting&&mixerView)renderRack();if(mixerState?.busy&&mixerState.snapshot().mutationStatus==='pending'&&!mixerLive?.busy)mixerLiveRawState=null;if(mixerView){if(mixerView.active)mixerRenderPending=true;else{mixerView.render();renderEffects();}renderMixerStatus();}mixerRoutingDialog?.render();}
function renderMixerStatus(){const node=$('#mixer-state');if(!node)return;if(restMixer?.isRestMode){const state=restMixer.snapshot(),receipt=state.receipt;const target=receipt?.target,rawLane=target?.kind==='lane'?project.cloud?.rawProject?.lanes?.find(lane=>lane.id===target.id):null,label=rawLane?.name||(target?.id==='master'?'Master':target?.kind==='bus'?'Bus':'Mixer'),requested=receipt?.control==='gain'?Math.round(receipt.requested*100)+'%':String(receipt?.requested??'');node.textContent=state.busy?state.status==='inspecting'?'Reading mixer setting…':`Applying ${label} ${receipt?.control||'setting'}${requested?' · '+requested:''}…`:receipt?receipt.status.replaceAll('_',' ')+(receipt.error?' · '+receipt.error:''):'Mixer settings loaded';node.dataset.state=state.status;if(receipt?.liveOnly&&!state.busy)node.textContent+=' · live only, not saved with the project';return;}const states={pan:mixerPan?.snapshot(),master:mixerMaster?.snapshot(),bus:mixerLive?.snapshot(),route:mixerRouting?.snapshot()},labels={pan:'Pan',master:'Master',bus:'Bus',route:'Route'},pending=Object.entries(states).find(([,state])=>state?.busy),routeRecovery=states.route?.receipt?.requiresInspection&&!states.route.receipt.inspection,key=routeRecovery?'route':states[mixerLastOperation]?.receipt?mixerLastOperation:Object.keys(states).find(key=>states[key]?.receipt),receipt=key?states[key].receipt:null;
 const readError=mixerInspectionError?.key===mixerInspectionKey()?mixerInspectionError.message:'';node.textContent=pending?labels[pending[0]]+': '+pending[1].status.replaceAll('_',' '):receipt?labels[key]+': '+receipt.status.replaceAll('_',' ')+(receipt.error?' · '+receipt.error:'')+(readError?' · '+readError:''):readError;
 node.dataset.state=pending?.[1]?.status||receipt?.status||(readError?'error':'idle');}

// One deferred canonical refresh after mixer saves, outside restMixer.busy: the
// write itself is confirmed from its PATCH reply, and the queue keeps the saved
// values visible until this re-read lands (no flicker, no per-click refresh).
let mixerRefreshRun=null,mixerRefreshAgain=false;function scheduleMixerRefresh(){if(mixerRefreshRun){mixerRefreshAgain=true;return mixerRefreshRun;}if(mixerQueue?.busy)return null;mixerRefreshRun=(async()=>{try{do{mixerRefreshAgain=false;await engine.refresh();}while(mixerRefreshAgain&&!mixerQueue?.busy);}catch{}finally{mixerRefreshRun=null;if(!mixerQueue?.busy)mixerQueue?.releaseHeld();renderMixer();}})();return mixerRefreshRun;}
// Mixer value/receipt changes update the strips in place (no DOM replacement),
// so fast M/S presses always land on a live element; structural changes re-render.
function mixerValuesChanged(){mixerModelEpoch++;/* Track headers (M / S) follow the queued value at once, like the Mixer strips: the save confirms later */syncPlaylistTrackLeds();if(restMixer?.isRestMode&&!restMixer.busy&&!mixerQueue?.busy&&!engine.interacting&&mixerView)renderRack();if(!mixerView)return;if(mixerView.active)mixerRenderPending=true;else if(!mixerView.syncControls()){mixerView.render();renderEffects();}else if(laneSends?.signatureChanged())renderEffects();renderMixerStatus();syncInspectorStrips();}
restMixer=new StudioApiMixer({engine,persistLaneMix:true,savedLaneMix:true,onChange:mixerValuesChanged,onApplied:()=>{if(!mixerQueue?.busy)scheduleMixerRefresh();}});
// Agent-safe mixing: one live-mix revision per project (getEngineMix seed, our
// write receipts, one waitEngineMix long-poll). Outside changes repaint the
// Mixer, Channel Rack and Playlist headers in place; every mix write carries it.
mixRevision=new MixRevisionTracker({client:{call:(...args)=>restMixer.client.call(...args)},onExternalChange:mixExternalChange,onMix:mix=>showLiveMix(mix)});
restMixer.mixRevision=mixRevision;engine.session.mixRevision=mixRevision;
// Logic aux Sends (setLaneSend / deleteLaneSend, 357): shown from the live mix /
// saved lanes, each gesture one guarded write and one global history step.
laneSends=new LaneSendsController({client:()=>restMixer?.isRestMode===true&&engine.ready&&!engine.loading&&laneSendsSupported()?restMixer.client:null,projectId:()=>engine.projectId||null,trackId:()=>engine.session.trackId??null,mixRevision:()=>mixRevision,history:()=>engine.patternHistory,
 buses:()=>currentMixerModel().rows.filter(row=>row.kind==='bus'&&row.id!=='master').map(row=>({id:row.id,name:row.name})),lanes:()=>currentMixerModel().rows.filter(row=>row.kind==='lane').map(row=>({id:row.id,name:row.name,saved:row.rawPersisted?.sends})),
 busy:()=>!directLevelEditable()||engine.interacting||!!mixerQueue?.busy||mixerRequestBusy(),onChange:()=>{try{renderEffects();}catch(error){clientLog('lane-sends-render-error',{message:String(error?.message||error).slice(0,160)});}},onBusesChanged:async()=>{await engine.refresh();renderMixer();},log:clientLog});
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
// Illogic: Logic channel strips (Logic fader taper, "-6.0" readout, upper strip sections via onRendered).
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
/** One live chain read per (lane, scope): the Inspector strip and the Mixer strip of the selected track.
 * A busy workspace defers it (retried on the next repaint and by a short timer); a failed read is not looped. */
const stripChainAttempts=new Map();let stripChainTimer=null;
function queueStripChainRead(row){
 if(!row||row.kind!=='lane'||!engine.ready||!restMixer?.isRestMode)return;
 const key=mixerFxKey(row),scope=JSON.stringify(mixerScope()),state=mixerFxStates.get(key);
 if(state?.reading||state?.busy)return;
 if(state?.acceptedProject===project&&state?.readScope===scope&&Array.isArray(state.plugins))return;
 // The same scope with a re-read project (the canonical refresh after an edit): the chain the edit confirmed is still the chain; keep it without another read.
 const savedIds=(Array.isArray(row.rawPersisted?.pluginChain)?row.rawPersisted.pluginChain:[]).map(item=>item?.pluginKey??item?.plugin_key??null),liveIds=(state?.plugins||[]).map(plugin=>plugin?.instance_id??plugin?.instanceId??plugin?.id??null);
 if(state&&state.readScope===scope&&Array.isArray(state.plugins)&&!state.preview&&!state.readError&&state.acceptedProject!==project&&savedIds.length===liveIds.length&&savedIds.every((id,index)=>id&&id===liveIds[index])){state.acceptedProject=project;state.requestProject=project;queueMicrotask(()=>{try{decorateMixerHost($('#mixer-strips'));syncInspectorStrips();}catch{}});return;}
 // One display read per (lane, scope). A project re-read in the same scope does not repeat it: the saved chain
 // (pluginKey = live instance id) already reflects the edit, and edits verify through their own controller.
 const attempt=stripChainAttempts.get(key);if(attempt?.scope===scope)return;
 const run=()=>{stripChainTimer=null;const live=currentMixerRow();if(!live||live.kind!=='lane'||mixerFxKey(live)!==key||scope!==JSON.stringify(mixerScope()))return;
  if(engine.interacting||workspaceBusy()||rangeBusy()){clearTimeout(stripChainTimer);stripChainTimer=setTimeout(run,250);return;}
  stripChainAttempts.set(key,{scope,project});if(stripChainAttempts.size>256)stripChainAttempts.delete(stripChainAttempts.keys().next().value);
  let channel;try{channel=mixerRowChannel(live);}catch{return;}
  readStripChain(channel,live,scope).catch(error=>clientLog('strip-chain-read-error',{laneId:live.id,message:String(error?.message||error).slice(0,160)}));};
 clearTimeout(stripChainTimer);stripChainTimer=setTimeout(run,0);
}
/** Display read for a strip: only listLanePlugins (shared inventory cache; no project re-read). A lane with
 * no live chain keeps showing its saved chain. Edits still verify through their own controller. */
async function readStripChain(c,row,scope){
 const key=mixerFxKey(row),prior=mixerFxStates.get(key);if(prior?.busy||prior?.reading||scope!==JSON.stringify(mixerScope()))return;
 const owner=project,options=scopedMixerOptions(c),controller=new MixerToolsController(options),started=performance.now();
 let result;try{result=await controller.listLanePlugins(row.id,{cached:true});}catch(error){clientLog('strip-chain-read',{laneId:row.id,ok:false,code:error?.code??null,status:error?.status??null,ms:Math.round(performance.now()-started)});return;}
 const now=mixerFxStates.get(key);if(project!==owner||scope!==JSON.stringify(mixerScope())||now?.busy||now?.reading||now!==prior)return;
 const raw=Array.isArray(result?.plugins)?result.plugins:null;if(!raw||raw.some(plugin=>!plugin||typeof plugin!=='object'||!Number.isInteger(plugin.index??plugin.plugin_index)))return;
 mixerFxStates.set(key,{...(prior||{}),plugins:normalizeLoadedPlugins(raw),savedOnly:[],knownBypass:new Set(raw.filter(plugin=>typeof plugin.bypassed==='boolean').map(plugin=>plugin.index??plugin.plugin_index)),readScope:scope,acceptedProject:owner,requestScope:scope,requestProject:owner,reading:false,readError:null});
 clientLog('strip-chain-read',{laneId:row.id,ok:true,slots:raw.length,stale:result.stale===true,ms:Math.round(performance.now()-started)});renderEffects();
}
async function readMixerFxSlots(c,row,scope,{anyEditor=false}={}){
 // A background display read: while history or another cloud edit runs it waits for the next render instead of failing (that failure was reported as the running Undo's error).
 const key=mixerFxKey(row),prior=mixerFxStates.get(key);if(prior?.busy||prior?.reading||engine.interacting||workspaceBusy()||rangeBusy()||!anyEditor&&activeEditor()!=='mixer'||scope!==JSON.stringify(mixerScope()))return;
 const owner=project,options=scopedMixerOptions(c),controller=new MixerToolsController(options),state={...prior,controller,reading:true,requestScope:scope,requestProject:owner,readError:null};mixerFxStates.set(key,state);renderEffects();
 try{await controller.refreshPlugins();options.assertScope();if(project!==owner||scope!==JSON.stringify(mixerScope())||mixerFxStates.get(key)!==state)return;state.plugins=controller.plugins;state.savedOnly=controller.savedOnlyPlugins();state.knownBypass=controller.knownBypassIndexes;state.readScope=scope;state.acceptedProject=owner;}
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
function mountMixerSidePanel(row,c){
 const output=$('#mixer-output');if(output)output.onclick=()=>{try{mixerRoutingDialog.open({laneId:row.id,busId:mixerOutputId(row)});}catch(error){fail(error);}};
 const host=$('#effect-rack .mixer-eq-host');if(!host)return;
 const laneId=row?.kind==='lane'&&c?.laneId===row.id?row.id:null,projectId=engine.projectId;
 if(!laneId||!restMixer?.isRestMode||!eqSupported(STUDIO_API_OPERATIONS)){mixerEqSection?.destroy();mixerEqSection=null;return;}
 if(mixerEqSection&&(mixerEqSection.laneId!==laneId||mixerEqSection.projectId!==projectId)){mixerEqSection.destroy();mixerEqSection=null;}
 // No EQ read while a cloud edit or history step runs (it would only be refused): load once idle.
 if(!mixerEqSection&&!mixerEqIdle()){retryMixerEqWhenIdle(laneId,projectId,{deferred:true});return;}
 if(!mixerEqSection){try{const options=scopedMixerOptions(c);mixerEqSection=mountMixerEqSection({projectId,laneId,trackId:engine.session.trackId??null,laneName:row.name||c.name||'Track',fetch:options.fetch,historyFetch:()=>scopedMixerOptions(c,{historyStep:true}).fetch,history:engine.patternHistory,historyScope:()=>engine.patternHistory?.context?.(),log:clientLog,onError:fail});mixerEqSection.projectId=projectId;const section=mixerEqSection;section.ready.then(()=>{if(mixerEqSection===section&&mixerEqBusyRefusal(section.loadError))retryMixerEqWhenIdle(laneId,projectId);else if(!section.loadError&&mixerEqRetry?.laneId===laneId&&!mixerEqRetry.waiting)mixerEqRetry=null;});}catch(error){clientLog('mixer-eq-load-error',{laneId,message:String(error?.message||error).slice(0,160)});if(mixerEqBusyRefusal(error))retryMixerEqWhenIdle(laneId,projectId);return;}}
 host.append(mixerEqSection.element);
}
/* An EQ load refused only because the workspace was busy (a ⌘D duplicate still running, a range edit…)
 * is retried once the workspace is idle again: for the same lane and project, a bounded number of times. */
const MIXER_EQ_RETRY_LIMIT=3;let mixerEqRetry=null;
function mixerEqBusyRefusal(error){return !!error&&/Wait for the current (cloud operation|audio range request) to finish/.test(String(error?.message||''));}
function mixerEqIdle(){const history=engine.patternHistory;return !workspaceBusy()&&!rangeBusy()&&!history?.reserved?.length&&!history?.externalPending&&!history?.busy&&!engine.historyPending&&!laneMoveBusy;}
function retryMixerEqWhenIdle(laneId,projectId,{deferred=false}={}){
 const same=mixerEqRetry&&mixerEqRetry.laneId===laneId&&mixerEqRetry.projectId===projectId;if(same&&mixerEqRetry.waiting)return;
 // A deferred first load (nothing was sent) does not count as a retry.
 const attempts=same?mixerEqRetry.attempts:deferred?-1:0;if(attempts>=MIXER_EQ_RETRY_LIMIT){clientLog('mixer-eq-load-retry',{laneId,attempts,gaveUp:true});return;}
 const token={laneId,projectId,attempts:attempts+1,waiting:true};mixerEqRetry=token;
 (async()=>{
  for(let wait=0;wait<2400&&!mixerEqIdle();wait++)await new Promise(resolve=>setTimeout(resolve,50));
  token.waiting=false;if(mixerEqRetry!==token||!mixerEqIdle()||engine.projectId!==projectId)return;
  clientLog('mixer-eq-load-retry',{laneId,attempt:token.attempts});
  if(mixerEqSection?.laneId===laneId&&mixerEqSection.projectId===projectId){const section=mixerEqSection;await section.reload();if(mixerEqSection===section&&mixerEqBusyRefusal(section.loadError))retryMixerEqWhenIdle(laneId,projectId);else if(mixerEqRetry===token)mixerEqRetry=null;}
  else if(currentMixerRow()?.id===laneId)renderEffects();
 })().catch(error=>clientLog('mixer-eq-load-retry',{laneId,message:String(error?.message||error).slice(0,160)}));
}
function renderEffects(){const owner=project,row=currentMixerRow(),base=mixerRowChannel(row),scope=JSON.stringify(mixerScope()),state=mixerFxStates.get(mixerFxKey(row)),cached=!state?.reading&&state?.acceptedProject===owner&&state?.readScope===scope&&Array.isArray(state.plugins),c=cached?{...base,plugins:state.plugins}:base,name=c?.name||'Mixer',plugins=normalizeLoadedPlugins(c?.plugins),recovery=!!state?.controller?.pluginMutation?.requiresInspection;$('#mixer-selected-title').textContent='- '+name;
 if(restMixer?.isRestMode&&activeEditor()==='mixer'&&mixerFxReadRequests.has(mixerFxKey(row))&&row?.kind==='lane'&&base?.plugins.some(plugin=>plugin.index===null)&&!cached&&!state?.reading&&!state?.busy&&(state?.requestScope!==scope||state?.requestProject!==owner))queueMicrotask(()=>readMixerFxSlots(base,row,scope).catch(fail));
 // Logic: the selected track's channel strip (Inspector and Mixer) shows its real chain. Read the live
 // slots (listLanePlugins) once per selection and scope, whichever pane is open.
 queueStripChainRead(row);
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
 decorateMixerHost($('#mixer-strips'));syncInspectorStrips();
 try{followPluginLink(row);}catch(error){clientLog('logic-plugin-link-error',{message:String(error?.message||error).slice(0,160)});}}
/* ---------- Illogic (mixer lane): Logic channel strips, Inspector strips, plug-in bypass, automation view ---------- */
/** A strip's chain for display: a fresh live read when cached, else the saved lane chain (opened like the Channel Rack plug-in button). */
function logicRowPlugins(row){
 if(!row)return{plugins:[],c:null,state:null,cached:false};
 const scope=JSON.stringify(mixerScope()),state=mixerFxStates.get(mixerFxKey(row)),cached=!state?.reading&&state?.acceptedProject===project&&state?.readScope===scope&&Array.isArray(state.plugins),base=mixerRowChannel(row),c=cached?{...base,plugins:state.plugins}:base;
 const known=index=>cached?!!state.knownBypass?.has(index):(base?.plugins||[]).some(raw=>(raw.index??raw.plugin_index)===index&&typeof raw.bypassed==='boolean');
 const live=normalizeLoadedPlugins(c?.plugins).filter(plugin=>Number.isInteger(plugin.index)&&plugin.index>=0).map(plugin=>({...plugin,bypassKnown:known(plugin.index)}));
 const saved=row.kind==='lane'&&!cached?savedChainPlugins(row.rawPersisted?.pluginChain).filter(plugin=>!live.some(item=>item.index===plugin.index)).map(plugin=>({...plugin,bypassKnown:false})):[];
 return{plugins:[...live,...saved].sort((a,b)=>a.index-b.index),c,state,cached};
}
function logicStripColor(row){if(row?.kind!=='lane')return row?.id==='master'?'#8a8d93':'#4f86c6';const channel=(project.channels||[]).find(item=>!item.patternSource&&item.laneId===row.id);return channelColor(channel?.color)||colors[Math.max(0,(project.cloud?.timelineLaneIds||[]).indexOf(row.id))%colors.length];}
function logicStripSpec(key){
 const row=currentMixerModel().rows.find(item=>item.key===key);if(!row)return null;
 const {plugins,state}=logicRowPlugins(row),{instrument,effects}=withPendingSlots(splitLogicChain(plugins,row.laneKind,{instrumentTypes:logicInstrumentTypes()}),(logicPendingSlots?.get(mixerFxKey(row))||[]).filter(entry=>!entry.landed?.(plugins))),eq=logicEqPlugin(plugins),lane=row.kind==='lane',master=row.kind==='bus'&&row.id==='master';
 // An instrument track whose chain shows no instrument: the catalog may name one of its plug-ins as the instrument.
 if(lane&&row.laneKind==='instrument'&&!instrument&&effects.length>0)ensureInstrumentCatalogTypes();
 const laneEq=lane&&!!restMixer?.isRestMode&&eqSupported(STUDIO_API_OPERATIONS),output=mixerOutputName(row);
 return{row,color:logicStripColor(row),instrument,effects,busy:!engine.ready||!!state?.busy||!!state?.reading,canAdd:engine.ready,status:state?.reading?'Reading effect slots…':state?.readError||state?.error||'',
  eq:{enabled:engine.ready&&(!!eq||laneEq),active:!!eq&&!eq.bypassed,title:eq?`${logicPluginName(eq)} · click to open`:laneEq?'Channel EQ · click to open':'Channel EQ: this channel has no EQ in Freestyle'},
  output:master?{name:'Output 1-2',enabled:false,title:'Stereo Out plays through the Freestyle cloud output'}:lane?{name:output&&output!=='Master'?output:'Stereo Out',enabled:engine.ready,title:`Output: ${output||'Stereo Out'} · click to route this track`}:{name:'Stereo Out',enabled:false,title:'Buses feed the Stereo Out'},mode:'Read',sends:logicSendsSpec(row)};
}
/** The strip's Sends: live/saved sends with bus names; buses and the Stereo Out have none. */
function logicSendsSpec(row){
 const reason=sendsUnavailableReason(row,{supported:!!laneSends&&restMixer?.isRestMode===true&&laneSendsSupported()});if(reason)return{enabled:false,reason};
 const read=laneSends.sendsFor(row.id,{saved:row.rawPersisted?.sends}),names=new Map(currentMixerModel().rows.filter(item=>item.kind==='bus').map(item=>[item.id,item.name||item.id]));
 // Current servers report sends in getProject lanes[] and getEngineMix tracks[]; an older one is read (listLaneSends) only when the slot is used.
 return{enabled:true,busy:!engine.ready||!!laneSends.writing,max:MAX_LANE_SENDS,status:laneSends.status||'',items:read.sends.map(send=>({...send,name:names.get(send.busId)||send.busId}))};
}
/** Logic send slot menu: No Send / Remove Send, the buses, New Bus, Post / Pre Fader. */
async function logicSendMenu(row,send,event){
 const saved=row.rawPersisted?.sends,point={clientX:event?.clientX??0,clientY:event?.clientY??0};
 if(!laneSends.sendsFor(row.id,{saved}).known){await laneSends.ensureListed([{id:row.id,saved}]);if(!laneSends.sendsFor(row.id,{saved}).known)throw new Error('Freestyle did not return this track’s sends. Refresh the mixer and try again.');}
 const read=laneSends.sendsFor(row.id,{saved}),buses=currentMixerModel().rows.filter(item=>item.kind==='bus'&&item.id!=='master').map(item=>({id:item.id,name:item.name||item.id}));
 const done=promise=>Promise.resolve(promise).catch(logicSendFailed);
 menu(point,sendSlotMenuItems({send,buses,used:read.sends.map(item=>item.busId),count:read.sends.length,busy:!!laneSends.writing||!engine.ready,actions:{
  none:()=>send?done(laneSends.remove(row.id,{saved,busId:send.busId})):null,
  choose:busId=>done(laneSends.chooseBus(row.id,{saved,fromBusId:send?.busId??null,busId})),
  newBus:()=>done(laneSends.newBus(row.id,{saved,fromBusId:send?.busId??null})),
  tap:preFader=>done(laneSends.setTap(row.id,{saved,busId:send.busId,preFader})),
 }}));
}
function logicSendFailed(error){if(error?.mixRevisionConflict===true||error?.code==='mix_revision_conflict'){toast(MIX_CONFLICT_NOTICE);return;}fail(error);}
/** Mix ▸ Delete Bus on an aux strip: one Undo step; refused while tracks still send to it. */
function deleteLogicBus(row){
 const raw=row.rawPersisted||{},chain=Array.isArray(raw.pluginChain)&&raw.pluginChain.length<=32&&raw.pluginChain.every(item=>item&&typeof item==='object'&&!Array.isArray(item))?raw.pluginChain:undefined;
 return laneSends.deleteBus({busId:row.id,restore:{name:raw.name,gain:raw.gain,muted:raw.muted,soloed:raw.soloed,display_order:raw.displayOrder??raw.display_order,plugin_chain:chain}}).then(()=>toast(`${row.name||row.id} deleted.`));
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
/* ---- Optimistic slots: a picked / dropped plug-in is drawn at once (pending) while Freestyle loads it ---- */
var logicPendingSlots=new Map();// `var`: strips can render before this line has run
function repaintLogicStrips(){try{decorateMixerHost($('#mixer-strips'));syncInspectorStrips();}catch(error){clientLog('logic-strip-repaint-error',{message:String(error?.message||error).slice(0,160)});}}
/** Show `entry` ({name, at?, replace?, instrument?}) on the row's strip now; the returned function removes it (idempotent). */
function showPendingSlot(row,entry){
 const key=mixerFxKey(row),list=logicPendingSlots.get(key)||[],instanceOf=plugin=>plugin?.instance_id??plugin?.instanceId??plugin?.id;
 /* landed(): the chain already shows a new instance (the add was acknowledged): the placeholder must not be drawn beside the real slot */
 if(!entry.replace&&!entry.instrument){const known=new Set(logicRowPlugins(row).plugins.map(instanceOf));entry.landed=plugins=>plugins.some(plugin=>instanceOf(plugin)!==undefined&&!known.has(instanceOf(plugin)));}
 list.push(entry);logicPendingSlots.set(key,list);entry.shownAt=performance.now();repaintLogicStrips();
 let done=false;return()=>{if(done)return;done=true;const now=logicPendingSlots.get(key)||[],at=now.indexOf(entry);if(at>=0)now.splice(at,1);if(!now.length)logicPendingSlots.delete(key);clientLog('logic-slot-optimistic',{name:String(entry.name).slice(0,80),ms:Math.round(performance.now()-entry.shownAt)});repaintLogicStrips();};
}
/** ⌥-drag (copy) or a drag to another strip (move): the same plug-in type, bypass and parameter values at the drop slot.
 * Public API: getLanePluginState (values) → addLanePlugin {plugin_id, position, bypassed, parameters}; a move then deletes the source. */
async function copyLogicPlugin(targetRow,{sourceRowKey,plugin,toIndex=null,move=false}={}){
 if(!engine.ready)return openCloudPanel();
 const sourceRow=currentMixerModel().rows.find(item=>item.key===sourceRowKey),name=logicPluginName(plugin),type=plugin?.type_id??plugin?.typeId??plugin?.type,instance=plugin?.instance_id??plugin?.instanceId??plugin?.id;
 if(!sourceRow||sourceRow.kind!=='lane'||targetRow.kind!=='lane')throw new Error('Plug-ins can be copied between track channel strips only: Freestyle reads a plug-in’s settings from tracks, not from buses.');
 if(typeof type!=='string'||!type)throw new Error(`${name} has no catalog type, so it cannot be copied.`);
 const owner=project,scope=JSON.stringify(mixerScope()),targetKey=mixerFxKey(targetRow),prior=mixerFxStates.get(targetKey);if(prior?.busy||prior?.reading)return false;
 if(!directLevelEditable()||engine.interacting)throw new Error('Finish the current edit before changing the effect chain.');
 selectLogicStrip(targetRow);
 const started=performance.now(),done=showPendingSlot(targetRow,{name,...(Number.isInteger(toIndex)?{at:toIndex}:{})});
 try{
  const sourceC=logicRowPlugins(sourceRow).c,targetC=logicRowPlugins(targetRow).c,options=scopedMixerOptions(targetC),source=new MixerToolsController(scopedMixerOptions(sourceC)),target=new MixerToolsController(options);
  await engine.flush();options.assertScope();if(owner!==project)throw new Error('The project changed. Drag the plug-in again.');
  await source.refreshPlugins();const current=source.plugins.find(item=>(item.instance_id??item.instanceId??item.id)===instance);if(!current)throw new Error(`${name} is no longer on ${sourceRow.name||'its track'}.`);
  let parameters=null,settingsNote='';
  try{const values=await source.readAllParameterValues(current);parameters=Object.fromEntries(values.filter(item=>Number.isInteger(item.index)&&item.index>=0&&Number.isFinite(item.value)).slice(0,4096).map(item=>[String(item.index),Math.max(0,Math.min(1,item.value))]));}
  catch(error){settingsNote=' with default settings (its current settings could not be read)';clientLog('logic-plugin-copy-state-error',{message:String(error?.message||error).slice(0,160)});}
  options.assertScope();await target.readCatalog({checkHost:true,cached:true});
  await target.loadPlugin(type,{...(Number.isInteger(toIndex)?{position:toIndex}:{}),...(current.bypassed===true?{bypassed:true}:{}),...(parameters&&Object.keys(parameters).length?{parameters}:{})});options.assertScope();
  if(target.pluginMutation?.requiresInspection){toast('Plug-in confirmation pending. Open FX and inspect the operation.');return false;}
  mixerFxStates.set(targetKey,{plugins:target.plugins,savedOnly:target.savedOnlyPlugins(),knownBypass:target.knownBypassIndexes,readScope:JSON.stringify(mixerScope()),acceptedProject:project,requestScope:JSON.stringify(mixerScope()),requestProject:project});done();renderEffects();
  clientLog('logic-plugin-copy',{type,move,toIndex,parameters:parameters?Object.keys(parameters).length:0,ms:Math.round(performance.now()-started)});
  if(move&&sourceRow.key!==targetRow.key){await editEffectSlot(logicRowPlugins(sourceRow).c,current,sourceRow,scope,owner,async(controller,live)=>{await controller.remove(live);return `${name} moved to ${targetRow.name||'the track'}${settingsNote}.`;});return true;}
  toast(`${name} copied to ${sourceRow.key===targetRow.key?`slot ${Number.isInteger(toIndex)?toIndex+1:target.plugins.length}`:targetRow.name||'the track'}${settingsNote}.`);return true;
 }finally{done();}
}
/* ---- Instrument slot menu ---- */
async function logicInstrumentMenu(row,instrument,event,rect=null){
 if(!engine.ready)return openCloudPanel();
 const anchor=event?.target?.closest?.('.logic-instrument')||event?.target||null,currentType=String(instrument?.type_id??instrument?.typeId??instrument?.type??'').toLowerCase();
 const replaceable=row.kind==='lane'&&!!STUDIO_API_OPERATIONS.replaceLaneInstrument&&engine.session.rawState?.studioApi===true;
 const pick=entry=>Promise.resolve().then(async()=>{
  if(entry.id==='__open__')return pluginDialog(logicRowPlugins(row).c,instrument,{nativeFirst:true});
  if(entry.id.startsWith('replace:'))return replaceTrackInstrument(row,{id:entry.id.replace(/^replace:/,''),name:entry.name});
  return newInstrumentTrackWith({id:entry.id.replace(/^new:/,''),name:entry.name});
 }).catch(fail);
 const popup=openLogicPluginMenu(document,{anchor,rect,title:`${row.name||'Track'} Instrument`,onPick:pick});
 let catalog;try{requireUiFeature('create_instrument');catalog=rememberInstrumentCatalog(await emptyInstrument.catalog());}catch(error){popup.close();throw error;}
 const usable=item=>item.creatable!==false&&item.availability?.installed!==false;
 // #20: the slot swaps the instrument of THIS track in place (replaceLaneInstrument, undoable); creating a track stays in the Track menu.
 popup.setEntries([...(instrument?[{id:'__open__',name:`${logicPluginName(instrument)} (open)`,category:'Current Instrument'}]:[]),
  ...catalog.filter(item=>typeof item.id==='string'&&item.id).map(item=>{const current=String(item.id).toLowerCase()===currentType;return replaceable?{id:`replace:${item.id}`,name:item.name||item.id,category:'Instrument',disabled:!usable(item)||current,title:!usable(item)?'Not installed on this Freestyle host':current?'This track already plays this instrument':`Replace ${logicPluginName(instrument)||'the instrument'} with ${item.name||item.id} on this track (keeps regions, notes, effects, sends and mix; ⌘Z restores the previous sound)`}:{id:`new:${item.id}`,name:item.name||item.id,category:'New Software Instrument Track',disabled:!usable(item),title:!usable(item)?'Not installed on this Freestyle host':`Create a new software instrument track with ${item.name||item.id}.`};})]);
}
/** #20: swap the instrument of an existing track in place (replaceLaneInstrument), as ONE undo step whose Undo sends the
 * reply's `undo` request (the exact previous sound) and whose Redo swaps again. Opens the new instrument's window. */
async function replaceTrackInstrument(row,{id,name}){
 requireUiFeature('create_instrument');if(!directLevelEditable()||engine.interacting)throw new Error('Finish the current edit before replacing the instrument.');
 const laneId=row.id,projectId=engine.projectId,client=new StudioApiClient(),started=performance.now();
 const ifMatch=async()=>(await client.call('getProject',{path:{project_id:projectId}})).etag;
 await engine.flush();const token=engine.patternHistory?.beginExternalStep?.({kind:'instrument_replace',label:`Replace Instrument (${name})`})??null;
 let handle;
 try{handle=await replaceLaneInstrument({client,projectId,laneId,instrumentId:id,ifMatch,log:clientLog});}
 catch(error){if(token)engine.patternHistory.failExternalStep(token,error);throw error;}
 const receipt=handle.receipt;clientLog('logic-instrument-replace',{laneId,type:id,replaced:receipt.replaced,previous:receipt.previousId,pluginIndex:receipt.pluginIndex,undo:!!receipt.undo,ms:Math.round(performance.now()-started),warnings:receipt.warnings.slice(0,3)});
 if(!receipt.replaced){if(token)engine.patternHistory.failExternalStep(token,null);toast(`${row.name||'This track'} already plays ${name}.`);return null;}
 logicInstrumentTypes().add(String(id).toLowerCase());await engine.refresh().catch(()=>{});
 const apply=async direction=>{const next=await handle[direction]();await engine.refresh().catch(()=>{});mixerFxStates.delete(mixerFxKey(row));renderEffects();clientLog('logic-instrument-replace',{laneId,direction,instrument:next.instrumentId,replaced:next.replaced});return{laneId,instrument:next.instrumentId};};
 if(token&&!engine.patternHistory.finishExternalStep(token,{detail:{laneId,from:receipt.previousId,to:receipt.instrumentId},undo:()=>receipt.undo?apply('undo'):Promise.reject(Object.assign(new Error('Freestyle returned no way to restore the previous instrument.'),{dispatched:false})),redo:()=>apply('redo')}))clientLog('logic-instrument-replace',{laneId,history:'not-recorded'});
 toast(`${row.name||'Track'}: ${receipt.previousName||'instrument'} replaced with ${receipt.instrumentName||name}.${receipt.undo?'':' (Freestyle returned no undo for the previous sound.)'}`);
 // Open the new instrument (listLanePlugins slot 0 on an instrument track, #19).
 const fresh=currentMixerModel().rows.find(item=>item.kind==='lane'&&item.id===laneId);if(!fresh)return null;
 const c=logicRowPlugins(fresh).c,options=scopedMixerOptions(c),controller=new MixerToolsController(options);await controller.refreshPlugins();options.assertScope();
 mixerFxStates.set(mixerFxKey(fresh),{plugins:controller.plugins,savedOnly:controller.savedOnlyPlugins(),knownBypass:controller.knownBypassIndexes,readScope:JSON.stringify(mixerScope()),acceptedProject:project,requestScope:JSON.stringify(mixerScope()),requestProject:project});renderEffects();
 const loaded=controller.plugins.find(plugin=>plugin.index===receipt.pluginIndex)||controller.plugins.find(plugin=>String(plugin.type_id??plugin.type??'').toLowerCase()===String(id).toLowerCase());
 return loaded&&Number.isInteger(loaded.index)?pluginDialog({...c,plugins:controller.plugins},loaded,{nativeFirst:true}):null;
}
/** Instrument menu → a new software-instrument track with that instrument (pending row at once), selected, its instrument window opened. */
async function newInstrumentTrackWith({id,name}){
 requireUiFeature('create_instrument');if(!directLevelEditable()||engine.interacting)throw new Error('Finish the current edit before adding an instrument track.');
 // The placeholder row stays until the saved track is drawn (creation, then the project read that paints it).
 const started=performance.now(),receipt=await withPendingTrack({name,kind:'instrument'},async()=>{const made=await createLaneWithHistory({type:id,name},{instrument:true});await engine.refresh();return made;});
 const laneId=receipt?.laneId??receipt?.lane?.id;if(!laneId)throw new Error('Inspect the saved tracks to confirm the new instrument track.');
 logicInstrumentTypes().add(String(id).toLowerCase());focusCreatedLane(laneId);engine.onEditSettled?.();
 const row=currentMixerModel().rows.find(item=>item.kind==='lane'&&item.id===laneId);clientLog('logic-instrument-track',{type:id,ms:Math.round(performance.now()-started)});
 if(!row){toast(`${name} track added.`);return null;}
 toast(`${name} track added.`);
 // Open the instrument from the LIVE chain (listLanePlugins): the saved chain's order is not the live slot order on a new track.
 const c=logicRowPlugins(row).c,options=scopedMixerOptions(c),controller=new MixerToolsController(options);await controller.refreshPlugins();options.assertScope();
 mixerFxStates.set(mixerFxKey(row),{plugins:controller.plugins,savedOnly:controller.savedOnlyPlugins(),knownBypass:controller.knownBypassIndexes,readScope:JSON.stringify(mixerScope()),acceptedProject:project,requestScope:JSON.stringify(mixerScope()),requestProject:project});renderEffects();
 const type=String(id).toLowerCase(),loaded=controller.plugins.find(plugin=>String(plugin.type_id??plugin.typeId??plugin.type??'').toLowerCase()===type)||splitLogicChain(controller.plugins,row.laneKind,{instrumentTypes:logicInstrumentTypes()}).instrument;
 if(loaded&&Number.isInteger(loaded.index))return pluginDialog({...c,plugins:controller.plugins},loaded,{nativeFirst:true});return null;
}
/* ---- Plug-in window Link: the linked window follows the selected track (same slot of its channel strip) ---- */
var pluginLink=null;// `var`: renderEffects can run before this line has
function pluginLinkSlot(c,plugin){
 const row=currentMixerModel().rows.find(item=>c?.laneId?item.kind==='lane'&&item.id===c.laneId:false);if(!row)return null;
 const {instrument,effects}=splitLogicChain(logicRowPlugins(row).plugins,row.laneKind,{instrumentTypes:logicInstrumentTypes()}),same=item=>item&&item.index===plugin.index;
 if(same(instrument))return{laneId:row.id,instrument:true};const position=effects.findIndex(same);return position<0?null:{laneId:row.id,position};
}
function pluginLinkControl(d,c,plugin){
 if(!c?.laneId)return{};
 d.addEventListener('close',()=>{if(pluginLink?.dialog===d&&!pluginLink.following)pluginLink=null;},{once:true});
 return{state:()=>pluginLink?.dialog===d,toggle:()=>{if(pluginLink?.dialog===d){pluginLink=null;return;}const slot=pluginLinkSlot(c,plugin);if(!slot)throw new Error('Link: this plug-in’s slot could not be found on its channel strip.');pluginLink={dialog:d,...slot};toast('Link on: this window follows the selected track.');}};
}
function followPluginLink(row){
 const link=pluginLink;if(!link||link.following)return;if(!link.dialog.isConnected||!link.dialog.open){pluginLink=null;return;}
 if(row?.kind!=='lane'||row.id===link.laneId)return;
 const {plugins,c}=logicRowPlugins(row),{instrument,effects}=splitLogicChain(plugins,row.laneKind,{instrumentTypes:logicInstrumentTypes()}),next=link.instrument?instrument:effects[link.position];
 // A track with nothing in that slot leaves the window where it is (as Logic does).
 if(!next||!Number.isInteger(next.index)||next.index<0)return;
 const place={left:link.dialog.style.left,top:link.dialog.style.top},slot={laneId:row.id,...(link.instrument?{instrument:true}:{position:link.position})};
 link.following=true;try{link.dialog.close();}catch{}
 pluginDialog(c,next,{nativeFirst:true}).then(dialog=>{if(!dialog?.isConnected){pluginLink=null;return;}if(place.left)dialog.style.left=place.left;if(place.top)dialog.style.top=place.top;pluginLink={dialog,...slot};dialog.logicPluginHeader?.repaint();},error=>{pluginLink=null;fail(error);});
}
function logicStripHandlers(){
 const open=(row,plugin)=>{selectLogicStrip(row);return pluginDialog(logicRowPlugins(row).c,plugin,{nativeFirst:true});};
 return{onError:fail,
  onSetting:(row,event)=>{const live=currentMixerModel().rows.find(item=>item.key===row.key)||row,gain=mixerControlMenuItems(live,'gain',null)[0],pan=mixerControlMenuItems(live,'pan',null)[0],c=mixerRowChannel(live);menu(event,[['Reset Volume',gain[1],gain[2],gain[3]],['Reset Pan',pan[1],pan[2],pan[3]],null,...(live.kind==='lane'?[...channelStripSettingEntries(live.id),null]:[]),...(live.kind==='bus'&&live.id!=='master'&&laneSends&&restMixer?.isRestMode===true&&laneSendsSupported()?[{label:'Delete Bus',disabled:!engine.ready||!!laneSends.writing,title:'Delete this bus (refused while tracks still send or route to it)',run:()=>deleteLogicBus(live)},null]:[]),{label:'Copy effects chain…',disabled:!engine.ready||!c,title:'Copy this channel’s effect chain to another track',run:()=>openSelectedMixerTools(c)}]);},
  onEq:row=>{selectLogicStrip(row);const {plugins,c}=logicRowPlugins(row),eq=logicEqPlugin(plugins);return eq?pluginDialog(c,eq):openLaneEqWindow(row,c);},
  onInstrument:open,onOpenPlugin:open,
  onInstrumentMenu:(row,instrument,event)=>{const node=event?.target?.closest?.('.logic-instrument')||event?.target,rect=node?.getBoundingClientRect?.()||null;selectLogicStrip(row);return logicInstrumentMenu(row,instrument,event,rect);},
  onCopyPlugin:(row,drop)=>copyLogicPlugin(row,drop),
  // The slot's rectangle is read before selecting the strip (selection repaints the strips and detaches the slot).
  onAddPlugin:(row,slot,event)=>{const node=event?.target?.closest?.('.logic-fx-slot,.logic-audio-fx')||event?.target,rect=node?.getBoundingClientRect?.()||null;selectLogicStrip(row);return addLogicPlugin(row,event,rect);},
  onBypass:(row,plugin)=>{if(!plugin.bypassKnown){selectLogicStrip(row);toast(`Reading ${logicPluginName(plugin)}’s live bypass state; click its power button again once the slot is read.`);return;}return bypassEffectSlot(logicRowPlugins(row).c,plugin,row,JSON.stringify(mixerScope()),project);},
  onSlotMenu:(row,plugin,event)=>logicSlotMenu(row,plugin,event),
  onReplaceMenu:(row,plugin,event)=>{const node=event?.target?.closest?.('.logic-fx-slot')||event?.target,rect=node?.getBoundingClientRect?.()||null;selectLogicStrip(row);return replaceLogicPlugin(row,plugin,event,rect);},
  onMove:(row,plugin,to)=>editEffectSlot(logicRowPlugins(row).c,plugin,row,JSON.stringify(mixerScope()),project,async(controller,current)=>{await controller.move(current,to);return `${logicPluginName(plugin)} moved to slot ${to+1}.`;}),
  onOutput:row=>mixerRoutingDialog.open({laneId:row.id,busId:mixerOutputId(row)}),
  onMode:(row,event)=>menu(event,logicModeMenu()),
  onSendMenu:(row,send,event)=>logicSendMenu(row,send,event),
  onSendLevel:(row,send,level)=>laneSends.setLevel(row.id,{saved:row.rawPersisted?.sends,busId:send.busId,level}).catch(logicSendFailed)};
}
let logicInstrumentTypeSet=null;
function logicInstrumentTypes(){return logicInstrumentTypeSet||=new Set([...LOGIC_INSTRUMENT_TYPES,...NATIVE_PLUGIN_CATALOG.filter(item=>item.kind==='instrument').map(item=>String(item.type).toLowerCase())]);}
/* Which chain plug-in is the track's instrument comes from Freestyle's instrument catalog (listInstrumentCatalog ids are the
 * engine generator type ids), not from a fixed list: an instrument track made with TAL-NoiseMaker, Surge XT, … showed its
 * instrument as an Audio FX insert and an empty Instrument slot. Read once per session, when a strip first needs it. */
var logicInstrumentCatalogRead=null;
function rememberInstrumentCatalog(rows){const types=logicInstrumentTypes();let added=false;for(const row of Array.isArray(rows)?rows:[]){const id=String(row?.id??'').toLowerCase();if(id&&!types.has(id)){types.add(id);added=true;}}if(added)repaintLogicStrips();return rows;}
function ensureInstrumentCatalogTypes(){
 if(logicInstrumentCatalogRead||!engine.ready||engine.loading||engine.session.rawState?.studioApi!==true)return;
 try{logicInstrumentCatalogRead=Promise.resolve(emptyInstrument.catalog()).then(rememberInstrumentCatalog).catch(error=>{clientLog('logic-instrument-catalog-error',{message:String(error?.message||error).slice(0,160)});const timer=setTimeout(()=>{logicInstrumentCatalogRead=null;},30000);timer?.unref?.();});}
 catch{/* the catalog reader is created later in start-up; the next strip render asks again */}
}
/**
 * Logic insert slot: a compact Category ▸ Plug-in menu (with search) anchored at
 * the slot; choosing closes it, adds through the existing guarded add (one Undo
 * step) and opens the new plug-in's window.
 */
/** Right side of a filled slot (Logic): the same Category ▸ Plug-in menu, with No Plug-in on top; a choice replaces the
 * slot's plug-in in place (one Undo step) and opens the new plug-in's window; No Plug-in removes it. */
async function replaceLogicPlugin(row,plugin,event,rect=null){
 if(!engine.ready)return openCloudPanel();
 const c=logicRowPlugins(row).c,anchor=event?.target?.closest?.('.logic-fx-slot')||event?.target||null,scope=JSON.stringify(mixerScope()),owner=project,name=logicPluginName(plugin);
 const pick=entry=>Promise.resolve().then(async()=>{
  if(entry.id==='__no_plugin__')return editEffectSlot(c,plugin,row,scope,owner,async(controller,current)=>{await controller.remove(current);return `${name} removed from ${row.name||'this track'}.`;});
  const done=showPendingSlot(row,{name:entry.name,at:plugin.index,replace:true});
  try{await editEffectSlot(c,plugin,row,scope,owner,async(controller,current)=>{await controller.readCatalog({checkHost:true,cached:true});await controller.replacePlugin(current,entry.id);return `${name} replaced by ${entry.name}.`;});}finally{done();}
  const live=currentMixerModel().rows.find(item=>item.key===row.key)||row,next=logicRowPlugins(live).plugins.find(item=>item.index===plugin.index);
  if(next&&(next.instance_id??next.instanceId??next.id)!==(plugin.instance_id??plugin.instanceId??plugin.id))return pluginDialog(logicRowPlugins(live).c,next,{nativeFirst:true});
 }).catch(fail);
 let controller;const popup=openLogicPluginMenu(document,{anchor,rect,title:`${row.name||'Track'} · replace ${name}`,onPick:pick});
 try{controller=new MixerToolsController(scopedMixerOptions(c));await controller.readCatalog({checkHost:true,cached:true});}
 catch(error){popup.close();throw error;}
 const id=item=>controller.isRestMode?item.id:item.path,category=item=>typeof item.category==='string'&&item.category.trim()?item.category.trim():'Other';
 popup.setEntries([{id:'__no_plugin__',name:'No Plug-in',category:'No Plug-in',title:`Remove ${name} from this slot`},...(controller.catalog||[]).filter(item=>id(item)).map(item=>({id:id(item),name:item.name||item.label||id(item),category:category(item),disabled:!!item.hostGated,title:item.hostGated?'Not installed on this Freestyle host':''}))]);
}
async function addLogicPlugin(row,event,rect=null){
 if(!engine.ready)return openCloudPanel();
 const c=mixerRowChannel(row),anchor=event?.target?.closest?.('.logic-fx-slot')||event?.target||null;
 let controller;const popup=openLogicPluginMenu(document,{anchor,rect,title:`${row.name||'Track'} Audio FX`,onPick:entry=>{/* the slot shows the plug-in in the same task as the pick; Freestyle's add follows */const done=showPendingSlot(row,{name:entry.name});Promise.resolve().then(()=>insertLogicPlugin(row,c,controller,entry,done)).catch(fail).finally(done);}});
 try{controller=new MixerToolsController(scopedMixerOptions(c));await controller.readCatalog({checkHost:true,cached:true});}
 catch(error){popup.close();throw error;}
 const id=item=>controller.isRestMode?item.id:item.path,category=item=>typeof item.category==='string'&&item.category.trim()?item.category.trim():item.availability==='loaded'?'Loaded in this session':'Other';
 popup.setEntries((controller.catalog||[]).filter(item=>id(item)).map(item=>({id:id(item),name:item.name||item.label||id(item),category:category(item),disabled:!!item.hostGated,title:item.hostGated?'Not installed on this Freestyle host':''})));
}
async function insertLogicPlugin(row,c,controller,entry,shown=()=>{}){
 const owner=project,options=scopedMixerOptions(c);await engine.flush();options.assertScope();if(owner!==project)throw new Error('The project changed. Choose the plug-in again.');
 const before=new Set((controller.plugins||[]).map(plugin=>plugin.instance_id??plugin.instanceId??plugin.id));toast(`Adding ${entry.name}…`);
 await controller.loadPlugin(entry.id);options.assertScope();
 if(controller.pluginMutation?.requiresInspection){toast('Plug-in confirmation pending. Open FX and inspect the operation.');return;}
 const body=controller.pluginMutation?.result?.structuredContent??controller.pluginMutation?.result,instance=body?.instanceId??body?.response?.instance_id??body?.response?.instanceId;
 const added=controller.plugins.find(plugin=>(plugin.instance_id??plugin.instanceId??plugin.id)===instance)||controller.plugins.find(plugin=>!before.has(plugin.instance_id??plugin.instanceId??plugin.id));
 const key=mixerFxKey(row);mixerFxStates.set(key,{plugins:controller.plugins,savedOnly:controller.savedOnlyPlugins(),knownBypass:controller.knownBypassIndexes,readScope:JSON.stringify(mixerScope()),acceptedProject:project,requestScope:JSON.stringify(mixerScope()),requestProject:project});shown();renderEffects();
 if(added&&Number.isInteger(added.index))return pluginDialog({...c,plugins:controller.plugins},added,{nativeFirst:true});
 toast(`${entry.name} added to ${row.name||'this track'}.`);
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
 * Illogic Inspector: a compact Logic strip pair (the selected track + Stereo Out)
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
function syncInspectorStrips(){for(const view of inspectorStripViews){if(view.destroyed||!view.element.isConnected||view.active)continue;try{if(!view.syncControls())view.render();else decorateMixerHost(view.element);}catch(error){clientLog('inspector-strip-error',{message:String(error?.message||error).slice(0,160)});}}}
/* Logic Mixer (X): docked in the bottom pane the editors use (body.mixer-open, --logic-editor-height). */
function toggleMixer(force){const win=$('#mixer');if(!win)return false;const open=typeof force==='boolean'?force:win.classList.contains('hidden');if(open)showWindow('mixer');else closeMixerDock();return !win.classList.contains('hidden');}
function closeMixerDock(){const win=$('#mixer');if(!win)return;if(!win.classList.contains('hidden')){mixerView?.cancel?.();win.classList.add('hidden');}$$('[data-window="mixer"]').forEach(b=>b.classList.remove('lit'));document.body.classList.remove('mixer-open');applyMixerHeight(false);}
function syncMixerDock(){const win=$('#mixer');if(!win)return;const open=!win.classList.contains('hidden');if(open&&editorPaneVisible())closeEditorPane();document.body.classList.toggle('mixer-open',open);$$('[data-window="mixer"]').forEach(b=>b.classList.toggle('lit',open));applyMixerHeight(open);}
/* The Mixer opens at its own height (Logic: about half the window, every strip row visible; the
 * user's last Mixer resize is remembered); the editors get their own height back when it closes. */
var editorHeightBeforeMixer=null;
const MIXER_HEIGHT_KEY='illogic-mixer-height';
function mixerDefaultHeight(){let saved=0;try{saved=Number(localStorage.getItem(MIXER_HEIGHT_KEY))||0;}catch{}const view=Number(innerHeight)||900,max=Math.max(240,view-200);return Math.round(Math.min(max,saved>0?saved:Math.max(560,view*.5)));}
function applyMixerHeight(open){
 const root=document.documentElement;
 if(open){if(editorHeightBeforeMixer==null)editorHeightBeforeMixer=root.style.getPropertyValue('--logic-editor-height')||'';root.style.setProperty('--logic-editor-height',`${mixerDefaultHeight()}px`);return;}
 if(editorHeightBeforeMixer==null)return;const before=editorHeightBeforeMixer;editorHeightBeforeMixer=null;
 if(before)root.style.setProperty('--logic-editor-height',before);else root.style.removeProperty('--logic-editor-height');
 // The shared resize handle stores its last drag as the editors' height: keep the editors' own value.
 const px=parseFloat(before);if(px>0)try{localStorage.setItem('illogic-editor-height',String(px));}catch{}
}
// A drag of the Mixer's top edge is remembered as the Mixer height (after the shared handler applied it).
$('#mixer .logic-editor-resize')?.addEventListener('pointerup',()=>setTimeout(()=>{if($('#mixer')?.classList.contains('hidden'))return;const px=parseFloat(document.documentElement.style.getPropertyValue('--logic-editor-height'));if(px>0)try{localStorage.setItem(MIXER_HEIGHT_KEY,String(Math.round(px)));}catch{}},0));
function setMixerFilter(filter){const win=$('#mixer');if(!win||!['single','tracks','all'].includes(filter))return;win.dataset.mixerFilter=filter;for(const button of $$('#mixer [data-mixer-filter]')){if(button===win)continue;const on=button.dataset.mixerFilter===filter;button.classList.toggle('selected',on);button.setAttribute('aria-pressed',String(on));}}
function mixerLocalMenu(event,kind){const filter=$('#mixer')?.dataset.mixerFilter||'all',click=id=>()=>$('#'+id)?.click();
 const canUndo=historyAvailable('undo'),canRedo=historyAvailable('redo');
 // The Mixer's local Edit / Options / View menus: the reference entries first (those Freestyle cannot do stay listed with the
 // reason), then the entries the reference has no counterpart for.
 const off=(label,title,shortcut='')=>({label,shortcut,disabled:true,title}),key=(label,shortcut,name,args=[])=>({label,shortcut,run:()=>logicKeyCommand(name,args)}),shown=label=>({label,checked:true,disabled:true,title:'Channel strips always show this component.'});
 const row=selectedTrackRow(),laneId=row===null?null:project.cloud.timelineLaneIds[row],strip=id=>{if(!laneId)return{disabled:true,title:'Select a track first (click its header or its channel strip).'};const item=channelStripSettingEntries(laneId).find(entry=>entry.id===id);return item?{disabled:!!item.disabled,title:item.title||''}:{disabled:true,title:'Not available for this track.'};};
 const NO_GROUP='Freestyle has no mixer groups.',NO_SURFACE='There are no control surface assignments.';
 const items={edit:[{label:'Undo',shortcut:'⌘Z',run:()=>undo(),disabled:!canUndo,title:canUndo?'':'There is nothing to undo.'},{label:'Redo',shortcut:'⇧⌘Z',run:()=>redo(),disabled:!canRedo,title:canRedo?'':'There is nothing to redo.'},{label:'Undo History…',shortcut:'⌃⌥⌘Z',run:()=>undoHistoryDialog()},off('Delete Undo History','The session history is cleared when the project is reloaded.'),null,
   off('Cut','Channel strips cannot be cut; delete a track in the Tracks area (⌘⌫).','⌘X'),{label:'Copy Channel Strip Setting',shortcut:'⌥⌘C',run:()=>window.illogic.copyChannelStripSetting(laneId),...strip('copy-strip')},{label:'Paste Channel Strip Setting',shortcut:'⌥⌘V',run:()=>window.illogic.pasteChannelStripSetting(laneId),...strip('paste-strip')},off('Delete','Delete a track in the Tracks area (⌘⌫).','⌫'),null,
   off('Select All','One channel strip is selected at a time.','⌘A'),key('Select Audio Channel Strips','⇧A','select-strips',['audio']),key('Select Instrument Channel Strips','⇧S','select-strips',['instrument']),key('Select Auxiliary Channel Strips','⇧F','select-strips',['bus']),key('Select Output Channel Strips','⇧O','select-strips',['master']),off('Select MIDI Channel Strips','There are no external MIDI channel strips.','⇧E'),off('Select Same-Colored Channel Strips','Freestyle tracks have no colour field.','⇧C'),key('Select Muted Channel Strips','⇧M','select-strips',['muted']),null,
   {label:'Reset Volume, Mute and Solo of All Tracks',run:click('reset-mixer')}],
  options:[{label:'Create New Auxiliary Channel Strip',shortcut:'⌃N',title:'Creates a bus; existing buses can be renamed and levelled in the same window.',run:click('mixer-buses')},off('Create Tracks for Selected Channel Strips','Every Freestyle channel strip already has its track.','⌃T'),null,
   off('Change Track in Record Mode','There is no control-surface track switching.'),off('Change Track in Play Mode','There is no control-surface track switching.'),off('Send All MIDI Mixer Data','There are no external MIDI channel strips.'),null,
   off('I/O Labels…','Freestyle has one stereo output; there are no I/O labels.'),off('Group Settings…',NO_GROUP,'⌥⇧G'),null,
   {label:'Route Selected Track…',title:'Choose the output (bus) of the selected track',run:click('mixer-routing')},{label:'Refresh Mixer',run:click('mixer-refresh')}],
  view:[off('Link Control Surfaces',NO_SURFACE),{label:'Channel Strip Components',submenu:['Setting Menu','EQ Display','Audio Effects','Sends','Output','Automation','Pan','Volume Fader','Mute/Solo','Track Name'].map(shown).concat([off('Audio Device Controls','A browser has no audio device controls for cloud tracks.'),off('Gain Reduction Meter','Freestyle reports no gain reduction.'),off('MIDI Effects','Freestyle has no MIDI effect slots.'),off('Group',NO_GROUP),off('VCA','Freestyle has no VCA faders.','⌃⇧V'),off('Track Number','Channel strips show their name; track numbers are in the Tracks area.','⌃⇧X'),off('Track Notes','Freestyle projects have no notes field.','⌃⇧N')])},off('Configure Channel Strip Components…','Channel strips always show the components listed above.','⌥X'),null,
   off('Folder Tracks','Freestyle has no folders.'),off('Add Signal Flow Channel Strips','The All view already shows buses and Stereo Out.'),off('Colors','Freestyle tracks have no colour field.','⌥C'),null,
   {label:'Single',checked:filter==='single',run:()=>setMixerFilter('single'),title:'The selected track and its signal flow (⇧X cycles Single, Tracks, All).'},{label:'Tracks',checked:filter==='tracks',run:()=>setMixerFilter('tracks')},{label:'All',checked:filter==='all',run:()=>setMixerFilter('all')},null,{label:'Close Mixer',shortcut:'X',run:()=>toggleMixer(false)}]}[kind];
 if(items)menu(event,items);}
for(const [id,kind]of [['mixer-menu-edit','edit'],['mixer-menu-options','options'],['mixer-menu-view','view']])$('#'+id)?.addEventListener('click',event=>mixerLocalMenu(event,kind));
for(const button of $$('#mixer .logic-mixer-filters [data-mixer-filter]'))button.addEventListener('click',()=>setMixerFilter(button.dataset.mixerFilter));
// The toolbar Mixer button toggles the dock (FL's raise-before-hide window rule does not apply to a docked pane).
document.addEventListener('click',event=>{const button=event.target.closest?.('[data-window="mixer"]');if(!button)return;event.preventDefault();event.stopPropagation();toggleMixer();},true);
/* Logic track automation (A): headers + curves over the Tracks area lanes. */
function logicAutomationView(){
 if(!logicAutomation)logicAutomation=new LogicAutomationView({document,getProject:()=>project,getStore:()=>automationStore,getLaneIds:()=>project?.cloud?.timelineLaneIds||[],getPluginParameters:laneId=>logicPluginParameterOptions(laneId),getPluginMenu:(laneId,pick)=>logicPluginParameterMenu(laneId,pick),onCreate:(laneId,option,at)=>createLogicAutomation(laneId,option,at),onCommit:packet=>commitLogicAutomation(packet),onMode:(laneId,event)=>menu(event,logicModeMenu()),menu,onStatus:text=>toast(text),onRepaint:()=>paintLogicAutomation(),
  beatAt:(clientX,grid)=>(clientX-playlistGridOrigin(grid))/barWidth*4,snapBeat:beat=>quantize(beat),getProjectEndSec:()=>logicProjectEndSec()});
 return logicAutomation;
}
function paintLogicAutomation(){const host=$('#track-lanes');if(!host||!project)return;try{logicAutomationView().paint(host);}catch(error){clientLog('logic-automation-paint-error',{message:String(error?.message||error).slice(0,160)});}}
function toggleAutomationView(force){const on=logicAutomationView().toggle(force);$('#playlist')?.classList.toggle('logic-automation-view',on);paintLogicAutomation();return on;}
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
 const flat=(at,duration,current)=>firstClickPoints({timeSec:at,value,current,durationSec:duration});
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
window.illogic=Object.assign(window.illogic||{},{toggleMixer,toggleAutomationView,mountInspectorStrips,syncInspectorStrips,automationViewEnabled:()=>!!logicAutomation?.enabled,get logicAutomation(){return logicAutomationView();}});
export {toggleMixer,toggleAutomationView,mountInspectorStrips};

function mixerChannelTarget(c){if(c?.patternSource){const model=currentMixerModel(),row=c.laneId?model.rows.find(row=>row.kind==='lane'&&row.id===c.laneId):model.rows.find(row=>row.kind==='bus'&&row.id===c.cloudSource?.busId);if(!row)throw new Error('Select an existing lane or bus in the Mixer to edit its effects.');return mixerRowChannel(row);}const target=c||mixerRowChannel(currentMixerRow());if(!target)throw new Error('Select a persisted mixer lane or bus first.');return target;}
function scopedMixerOptions(c,{historyStep=false}={}){
 const current=project,projectId=current.cloud?.projectId||current.id,trackId=current.cloud?.trackId,version=engine.loadVersion;
 // A history Undo/Redo step runs while the journal is busy by design; every other guard stays.
 // assertCurrent: the open project only (displaying loaded controls); assertScope adds the idle-workspace guard for reads/writes.
 const assertCurrent=()=>{if(!engine.ready||engine.loading||engine.loadVersion!==version||engine.projectId!==projectId||engine.session.projectId!==projectId||engine.session.trackId!==trackId)throw new Error('The cloud project changed. Reopen its plugin controls before editing.');},assertScope=()=>{assertRangeIdle({ignorePatternHistory:historyStep});assertCurrent();};
 /* The pre-send guard refused: nothing was sent (a history step must never call that uncertain). */const guarded=async task=>{try{assertScope();}catch(error){throw Object.assign(error,{dispatched:false,historyNotApplied:true});}const result=await task();assertScope();return result;};
 assertScope();return{project:current,channel:mixerChannelTarget(c),assertScope,assertCurrent,...(historyStep?{onChainChanged:detail=>rereadMixerFx(detail)}:{chainPreview:previewMixerChain,history:engine.patternHistory,historyController:()=>new MixerToolsController(scopedMixerOptions(c,{historyStep:true}))}),inventory:{cache:pluginInventory,scope:()=>({projectId,trackId,loadVersion:version})},liveLaneIds:()=>{const mix=mixRevision?.projectId===projectId?mixRevision.mix:null;return Array.isArray(mix?.tracks)?new Set(mix.tracks.map(track=>track?.db_track_id).filter(id=>typeof id==='string'&&id)):null;},liveControl:engine.liveControl,call:(name,args,options)=>guarded(()=>engine.session.call(name,args,options)),fetch:(...args)=>guarded(()=>hostFetch(...args)),onChanged:()=>guarded(()=>engine.refresh()),onRoute:({laneId})=>{assertScope();return mixerRoutingDialog.open({laneId});},onError:fail};
}
async function openSelectedMixerTools(c=mixerRowChannel(currentMixerRow()),{initialTab='slots',replacePlugin=null,copySourceId=null}={}){if(!engine.ready)return openCloudPanel();const options=scopedMixerOptions(c);await engine.flush();options.assertScope();return openMixerTools({...options,initialTab,...replacePlugin?{replacePlugin}:{},...copySourceId?{copySourceId}:{}});}
/* Logic Copy / Paste Channel Strip Setting: Freestyle's effects-chain copy (copyLaneEffectChain), reviewed in a Paste Channel Strip Setting sheet before saving. */
async function openPasteChannelStrip(c,copySourceId,copiedSends=null){if(!engine.ready)return openCloudPanel();const options=scopedMixerOptions(c);await engine.flush();options.assertScope();return openPasteChannelStripSheet({...options,copySourceId,sends:channelStripSendsPaste(c,copiedSends),onPasted:receipt=>toast(`Pasted the channel strip setting onto ${receipt.review?.destinationName||'the track'}.`)});}
let copiedChannelStrip=null;
/** Logic copies a strip's sends with its setting: the sends known at Copy replace the destination's (one Undo step) after the chain is pasted. */
function channelStripSends(laneId){if(!laneSends||restMixer?.isRestMode!==true||!laneSendsSupported())return null;const row=currentMixerModel().rows.find(item=>item.kind==='lane'&&item.id===laneId),read=row?laneSends.sendsFor(laneId,{saved:row.rawPersisted?.sends}):null;return read?.known&&!read.sends.some(send=>send.pending)?read.sends.map(({busId,level,preFader})=>({busId,level,preFader})):null;}
function channelStripSendsPaste(c,sends){
 if(!Array.isArray(sends)||!c?.laneId||!laneSends)return null;const names=new Map(currentMixerModel().rows.filter(row=>row.kind==='bus').map(row=>[row.id,row.name||row.id])),live=new Set(names.keys()),usable=sends.filter(send=>live.has(send.busId));
 return{summary:usable.length?`Sends: ${usable.map(send=>`${names.get(send.busId)} ${logicLevelText(send.level)} dB${send.preFader?' (pre)':''}`).join(', ')} replace the track’s sends.`:'Sends: the copied strip has none; the track’s sends are removed.',
  apply:()=>{const row=currentMixerModel().rows.find(item=>item.kind==='lane'&&item.id===c.laneId);return laneSends.replaceAll(c.laneId,{saved:row?.rawPersisted?.sends,sends:usable});}};
}
function channelStripSettingEntries(laneId){
 const lane=(project.cloud?.rawProject?.lanes||[]).find(item=>item.id===laneId)||null,row=laneId?currentMixerModel().rows.find(item=>item.kind==='lane'&&item.id===laneId):null,c=row?mixerRowChannel(row):null;
 const run={'copy-strip':()=>{copiedChannelStrip={projectId:engine.projectId,laneId,name:lane?.name||laneId,sends:channelStripSends(laneId)};toast(`Copied ${lane?.name||'the track'}’s channel strip setting (effects chain${copiedChannelStrip.sends?' and sends':''}).`);},'paste-strip':()=>{if(!c)throw new Error('Open the Mixer (X) to paste onto this track.');return openPasteChannelStrip(c,copiedChannelStrip?.laneId,copiedChannelStrip?.sends??null);}};
 return channelStripSettingItems({projectId:engine.projectId,laneId,laneKind:lane?.kind||null,name:lane?.name||'',copied:copiedChannelStrip,ready:engine.ready&&!engine.loading}).map(item=>({...item,run:run[item.id]}));
}
function channelStripSettingMenu(laneId,event){menu(event,channelStripSettingEntries(laneId));}
async function pluginDialog(c,plugin,{nativeFirst=false}={}){
 if(!engine.ready)return openCloudPanel();
 if(!Number.isInteger(plugin?.index)||plugin.index<0)throw new Error('Select a plugin with a live slot index.');
 const options=scopedMixerOptions(c),controller=new MixerToolsController(options),editorController=new MixerToolsController(options),d=dialog(`${plugin.name||'Plugin'} (${c?.name||'Master'})`, '<p class="plugin-loading">Loading parameters from Freestyle…</p>',{modeless:true,className:'plugin-parameter-dialog'});d.dataset.pluginChannel=c?.id||'';/* The window grows to the plug-in's size once its first frame lands: keep it on screen. */if(typeof ResizeObserver==='function'){const keepOnScreen=()=>{const rect=d.getBoundingClientRect();if(!rect.width||!rect.height)return;if(rect.bottom>innerHeight-6)d.style.top=Math.max(30,Math.round(innerHeight-rect.height-6))+'px';if(rect.right>innerWidth-6)d.style.left=Math.max(6,Math.round(innerWidth-rect.width-6))+'px';},observer=new ResizeObserver(keepOnScreen);observer.observe(d);d.addEventListener('close',()=>observer.disconnect(),{once:true});}
 // The window belongs to this exact instance: a chain read without it closes the window (and its GUI polling).
 {const instance=plugin.instance_id??plugin.instanceId??plugin.id;if(controller.target.kind==='lane')registerPluginWindow({dialog:d,projectId:controller.projectId,laneId:controller.target.id,instanceId:typeof instance==='string'?instance:null,refresh:()=>{remoteEditor?.refresh?.({fresh:true});},onStale:()=>toast(`${plugin.name||'Plugin'} is no longer on ${c?.name||'this track'}; its window was closed.`)});}
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
  // ◀ ▶ / Setting list: the factory programs the plug-in reports (setLanePluginProgram; lanes only). Link: follow the selected track.
  const programs={state:()=>{const snapshot=controller.snapshot,count=controller.target.kind==='lane'?Number(snapshot?.program_count):NaN;return{count:Number.isInteger(count)?count:0,current:Number.isInteger(snapshot?.current_program_index)?snapshot.current_program_index:null,programs:Array.isArray(snapshot?.programs)?snapshot.programs:[],busy:!!controller.busy};},
   select:async index=>{assertActive();await pluginDialogIdle();assertActive();await controller.program(plugin,index);assertActive();toast(`${logicPluginName(plugin)}: ${logicProgramName(controller.snapshot?.programs,index)}.`);try{remoteEditor?.refresh?.({fresh:true});}catch{}try{if(d.isConnected&&d.open)paintParameters();}catch{}}};
  const logicPluginHeader=mountLogicPluginHeader(d,content,{programs,link:pluginLinkControl(d,c,plugin),trackName:c?.name||'Stereo Out',pluginName:logicPluginName(plugin),tabs:{show:showPluginTab,current:()=>d.dataset.pluginTab},hasTab:name=>name==='eq'?!!content.querySelector('.plugin-eq-panel'):true,bypass:logicPluginBypass(c,plugin),menu,settingItems:()=>[{label:'Copy effects chain…',title:'Copy this track’s whole effect chain to another track',run:()=>{d.close();return openSelectedMixerTools(c);}},{label:'Slots, bypass and routing…',run:()=>{d.close();return openSelectedMixerTools(c);}}],onError:fail});d.logicPluginHeader=logicPluginHeader;
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
   try{await pending;assertActive();{const receipt=controller.pluginMutation;remoteEditor?.refresh?.({fresh:true,woken:receipt?.kind==='parameter'?editorFrameWokenFrom(receipt.result):null});}const after=confirmedParameterValue(index),unconfirmed=!!controller.pluginMutation?.requiresInspection;
    clientLog('plugin-param-write',{laneId:controller.target.id,pluginIndex:plugin.index,index,paramId:row?.id??null,form,before:before??null,requested,reported:after??null,unconfirmed,ms:Date.now()-started});
    if(unconfirmed){parameterMessage=`Freestyle accepted ${row?.name||'the parameter'} but reports ${after??'an unknown value'} instead of ${requested}. Inspect the plugin before editing again.`;toast(parameterMessage);}
    else{if(controller.parameterWriteValue(index)===undefined)toast('Plugin parameter updated in Freestyle.');if(history&&row&&Number.isFinite(before)&&Number.isFinite(after)&&Math.abs(before-after)>1e-9)recordPluginParameterHistory({c,plugin,index,paramId:row.id,name:row.name,form,before,after,scope:historyScope,dialog:{controller,isOpen:()=>d.isConnected&&d.open,repaint:()=>{if(d.isConnected)paintParameters();},refreshGui:()=>remoteEditor?.refresh?.({fresh:true})}});}}
   catch(error){parameterMessage=error.message;clientLog('plugin-param-write',{index,requested,outcome:'error',message:String(error.message||'').slice(0,200),code:error.code||null,status:error.status||null});fail(error);}finally{if(d.isConnected)paintParameters();}
  };
  const runParameter=async task=>{if(parameterBusy)return;parameterBusy=true;parameterMessage='';paintParameters();try{assertActive();await task();assertActive();}catch(error){parameterMessage=error.message;fail(error);}finally{parameterBusy=false;if(d.isConnected)paintParameters();}};
  const paintParameters=()=>{
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
   // #3: a Stereo Out (master bus) slot mirrors its editor through the master-bus editor routes (REST frames).
   if(editorController.isRestMode&&editorController.target.kind==='bus'&&editorController.target.id==='master'&&busPluginGuiSupported(editorController.operations))try{
    assertActive();await engine.flush();assertActive();const previous=remoteEditor;
    viewer=new PluginGuiView({getMaxWidth:()=>Math.max(480,Math.min(1280,Math.floor((globalThis.innerWidth||1280)*.9))),guard:assertGuiCurrent,whenIdle:pluginDialogIdle,idleNow:()=>!workspaceBusy(),target:{projectId:editorController.projectId,busId:'master',pluginIndex:plugin.index,instanceId:plugin.instance_id??plugin.instanceId??null,pluginType:plugin.type_id??plugin.type??null},isVisible:()=>d.isConnected&&d.open&&d.dataset.pluginTab==='gui'&&!document.hidden,onParametersChanged:info=>{if(info?.kind==='type')guiParameterSync.schedule();},
     onMismatch:()=>{toast('This Stereo Out slot changed in Freestyle. Refreshing its plugin chain.');controller.refreshPlugins().catch(()=>{});},onStateChange:({state})=>{if(!current())return;if(state==='displaced'){viewport.classList.add('native-plugin-inactive');allowReopen();}else if(state==='error')allowReopen();}});
    remoteEditor=viewer;await previous?.close?.().catch(()=>{});assertActive();viewer.mount(viewport);await viewer.open();clientLog('plugin-window-master-editor',{pluginIndex:plugin.index,type:plugin.type_id??plugin.type??null});
    if(current())d.style.width='min(1000px,95vw)';else await viewer.close();return;
   }catch(error){if(editorNotAvailable(error)){viewport.textContent=NO_EDITOR_MESSAGE;if(current())showPluginTab('parameters');return;}if(current()){viewport.textContent=error.message;if(d.dataset.pluginTab==='gui'){showPluginTab('parameters');toast('Original plugin GUI unavailable: '+error.message+' Showing typed parameters.');}allowReopen();}return;}
   // Studio API v1 REST editor mirror (frame long-poll + forwarded input), see plugin-gui-view.js.
   if(editorController.isRestMode&&editorController.target.kind==='lane'&&pluginGuiSupported(editorController.operations))try{
    assertActive();await engine.flush();assertActive();const binding=candidateEditorBinding(),previous=remoteEditor,fresh=await readEditorBinding();if(fresh.laneId!==binding.laneId||fresh.pluginIndex!==binding.pluginIndex||fresh.instanceId!==binding.instanceId)throw new Error('The plugin instance changed before its original editor opened.');
    viewer=new PluginGuiView({getMaxWidth:()=>Math.max(480,Math.min(1280,Math.floor((globalThis.innerWidth||1280)*.9))),guard:assertGuiCurrent,whenIdle:pluginDialogIdle,idleNow:()=>!workspaceBusy()&&!engine.patternHistory?.reserved?.length,frameStream:new EditorFrameStream({monitor:engine.monitor,log:clientLog}),target:{projectId:editorController.projectId,laneId:binding.laneId,pluginIndex:binding.pluginIndex,instanceId:binding.instanceId,pluginType:plugin.type_id??plugin.type??null,trackId:editorController.context().track_id},isVisible:()=>d.isConnected&&d.open&&d.dataset.pluginTab==='gui'&&!document.hidden,onParametersChanged:info=>{if(info?.kind==='type')guiParameterSync.schedule();},onGestureStart:detail=>gestureHistory.begin(detail),onGestureEnd:detail=>gestureHistory.end(detail),
     onMismatch:error=>{toast(`This plugin slot changed in Freestyle${error.currentPluginType?` (now ${error.currentPluginType})`:''}. Refreshing its plugin chain.`);controller.refreshPlugins().catch(()=>{});},onTargetMissing:error=>verifyInstance(()=>viewer?.setState?.('error',`${plugin.name||'This plugin'} is still in the chain, but Freestyle could not reach its editor: ${error.message}`)),onStateChange:({state})=>{if(!current())return;if(state==='displaced'){viewport.classList.add('native-plugin-inactive');allowReopen();}else if(state==='error'&&!viewer.ownershipBlocked)allowReopen();}});
    remoteEditor=viewer;await previous?.close?.().catch(()=>{});assertActive();viewer.mount(viewport);await viewer.open();
    if(current())d.style.width='min(1000px,95vw)';else await viewer.close();return;
   }catch(error){if(editorNotAvailable(error)){viewport.textContent=NO_EDITOR_MESSAGE;remoteButton.textContent='No editor window (built-in effect)';if(current())showPluginTab('parameters');return;}if(error?.status===409&&error.code==='target_not_loaded'){viewport.textContent='Checking whether this plugin is still in its chain…';verifyInstance(()=>{viewport.textContent=error.message;allowReopen();});return;}if(current()){viewport.querySelector('.plugin-gui-status')?viewport.querySelector('.plugin-gui-status').textContent=error.message:viewport.textContent=error.message;if(d.dataset.pluginTab==='gui'&&!viewport.querySelector('img[src]')){showPluginTab('parameters');toast('Original plugin GUI unavailable: '+error.message+' Showing typed parameters.');}if(error.code!=='editor_ownership_cleanup_failed')allowReopen();}return;}
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
  // #6: a built-in effect (hasEditor:false) has no editor window: open its Controls directly, never request an editor.
  const noEditor=pluginHasEditor(plugin)===false;
  if(noEditor){remoteButton.disabled=true;remoteButton.textContent='No editor window (built-in effect)';remoteButton.title=NO_EDITOR_MESSAGE;content.querySelector('[data-plugin-tab="gui"]')?.setAttribute('disabled','');clientLog('plugin-window-no-editor',{type:plugin.type_id??plugin.type??null,hasEditor:plugin.hasEditor??null});if(!eqTab)showPluginTab('parameters');}
  // Single-click channel opening shows the native GUI at once, like FL; typed parameters keep loading behind it.
  if(nativeFirst&&!eqTab&&!noEditor)remoteButton.onclick();
 const openStarted=Date.now();let openPath='';
 try{await engine.flush();assertActive();if(!controller.isRestMode){await controller.refresh();assertActive();}if(controller.hasFreshInventory())openPath='cached-inventory';else if(controller.adoptSavedSlot(plugin))openPath='saved-slot';else openPath='live-inventory';if(openPath!=='saved-slot')await controller.ensurePlugin(plugin,{cached:true});assertActive();await controller.readPlugin(plugin.index);assertActive();gestureHistory.noteRead();parameterMessage='';clientLog('plugin-window-params',{channel:c?.name||null,laneId:controller.target.id,pluginIndex:plugin.index,path:openPath,ms:Date.now()-openStarted,loaded:controller.parameters.length,total:controller.parameterPagination.total});}
 catch(error){parameterMessage=error.message;clientLog('plugin-window-params-error',{channel:c?.name||null,laneId:controller.target?.id||null,pluginIndex:plugin.index,path:openPath,ms:Date.now()-openStarted,message:String(error.message||'').slice(0,200),code:error.code||null,status:error.status||null});if(d.isConnected&&d.open)fail(error);}
 finally{parameterBusy=false;if(d.isConnected&&d.open){paintParameters();/* the snapshot now names the plug-in's programs: enable ◀ ▶ */try{d.logicPluginHeader?.repaint();}catch{}}}
 return d;
}
function pianoGesture({element,event,initial,compute,paint,restore=()=>{},commit=()=>{},isValid=()=>true,changed,viewport=null,click=null}={}){
 activePianoCancel?.();const scope=JSON.stringify(fileImportScope()),sessionProjectId=engine.session.projectId,valid=()=>scope===JSON.stringify(fileImportScope())&&sessionProjectId===engine.session.projectId&&isValid(),gesture=new PianoGesture({initial,origin:{clientX:event.clientX,clientY:event.clientY,pointerId:event.pointerId},compute,paint,restore,isValid:valid,...changed?{changed}:{}});let finished=false,physicalPoint={clientX:event.clientX,clientY:event.clientY,pointerId:event.pointerId};const initialScroll=viewport?{left:viewport.scrollLeft,top:viewport.scrollTop}:null,contentPoint=sample=>({clientX:sample.clientX+(viewport?viewport.scrollLeft-initialScroll.left:0),clientY:sample.clientY+(viewport?viewport.scrollTop-initialScroll.top:0),pointerId:event.pointerId});
 const autoscroll=viewport?new PlaylistAutoScroll({viewport,pointerId:event.pointerId,getInsets:()=>({left:PIANO_KEY_WIDTH,top:PIANO_RULER_HEIGHT}),isValid:valid,onScroll:()=>gesture.move(contentPoint(physicalPoint))}):null;autoscroll?.update(event,{enabled:false});
 const finish=(cancel,sample)=>{if(finished||!gesture.matches(sample))return;const finalPoint=Number.isFinite(sample?.clientX)&&Number.isFinite(sample?.clientY)?sample:physicalPoint;const result=gesture.finish(contentPoint(finalPoint),{cancel});if(!result)return;finished=true;autoscroll?.destroy();activePianoCancel=null;element.onpointermove=element.onpointerup=element.onpointercancel=element.onlostpointercapture=null;try{if(element.hasPointerCapture?.(event.pointerId))element.releasePointerCapture(event.pointerId);}catch{}engine.interacting=false;if(result.changed)commit(result.state);else if(click&&!cancel&&!result.cancelled&&!gesture.moved)click();};
 const cancel=()=>finish(true);cancel.pointerId=event.pointerId;activePianoCancel=cancel;engine.interacting=true;try{element.setPointerCapture(event.pointerId);}catch{}element.onpointermove=sample=>{if(!gesture.matches(sample)||!Number.isFinite(sample?.clientX)||!Number.isFinite(sample?.clientY))return;physicalPoint={clientX:sample.clientX,clientY:sample.clientY,pointerId:event.pointerId};gesture.move(contentPoint(physicalPoint));autoscroll?.update(sample,{enabled:gesture.moved});};element.onpointerup=sample=>finish(false,sample);element.onpointercancel=element.onlostpointercapture=sample=>finish(true,sample);return gesture;
}
/* Collapse Mode: one row model (logic-piano.js pianoRowModel) for rendering, hit testing and gestures.
 * renderPiano() refreshes it; every render cancels the active gesture first, so a gesture sees one model. */
let pianoCollapsed=false,pianoRowsNow=pianoRowModel([]);
const pianoTop=pitch=>pianoRowsNow.rowOf(pitch)*pianoRowHeight+1,pianoPitchAtY=y=>pianoRowsNow.pitchAt(Math.floor(y/pianoRowHeight));
/* The pure stroke/slice modules work in full-keyboard rows (row = 127 − pitch): translate a shown row to that space. */
const pianoFullRow=row=>{if(!pianoRowsNow.collapsed)return row;const whole=Math.floor(row);return 127-pianoRowsNow.pitchAt(whole)+(row-whole);};
const pianoMovePitches=(moved,initial,rows)=>{if(!pianoRowsNow.collapsed)return moved;const shifted=shiftPitchesByRows(initial,rows,pianoRowsNow);return moved.map((note,i)=>({...note,pitch:shifted[i].pitch}));};
/* The velocity (MIDI Draw) lane: a full-velocity bar fills the lane that is actually laid out (the lane is shorter than
 * the old fixed 128 px range, which clipped every bar above about half velocity). No layout (tests): the fixed range. */
function pianoVelocityRange(){const height=$('#velocity-grid')?.clientHeight||0;return height>12?height-5:PIANO_VELOCITY_RANGE;}
function setPianoCollapsed(value){pianoCollapsed=!!value;const button=$('#piano-collapse');if(button){button.setAttribute('aria-pressed',String(pianoCollapsed));button.classList.toggle('lit',pianoCollapsed);}pianoNeedsFocus=true;renderPiano();if(pianoCollapsed&&!pianoRowsNow.collapsed)toast('Collapse Mode: this region has no notes yet, so every pitch row stays shown.');return true;}
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
  const rect=keys.getBoundingClientRect(),visible=viewport.getBoundingClientRect(),pitch=pianoRowsNow.collapsed?pianoPitchAtY(next.clientY-rect.top):127-Math.floor((next.clientY-rect.top)/rowHeight),inside=next.clientX>=rect.left&&next.clientX<rect.right&&next.clientY>=visible.top+PIANO_RULER_HEIGHT&&next.clientY<visible.bottom&&pitch>=0&&pitch<=127;
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
  for(const node of $$('.piano-note[data-note]')){if(!pending.noteIds.includes(node.dataset.note))continue;const note=updates.get(node.dataset.note);if(!note)continue;if(!notePropertiesStyles.has(node))notePropertiesStyles.set(node,{css:node.style.cssText,text:node.firstChild.textContent});node.style.left=`${note.start/4*pianoBarWidth}px`;node.style.width=`${note.duration/4*pianoBarWidth}px`;node.style.top=`${pianoTop(note.pitch)}px`;node.firstChild.textContent=flNoteName(note.pitch);}
  for(const node of $$('#piano [data-velocity]')){if(!pending.noteIds.includes(node.dataset.velocity))continue;const note=updates.get(node.dataset.velocity);if(!note)continue;if(!notePropertiesStyles.has(node))notePropertiesStyles.set(node,{css:node.style.cssText});node.style.height=`${(note.velocity??.8)*pianoVelocityRange()}px`;}
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
function pianoMenu(e){activePianoCancel?.();menu(e,[['Draw notes','P',()=>setPianoTool('draw')],['Paint notes','B',()=>setPianoTool('paint')],['Delete notes','D',()=>setPianoTool('erase')],['Select notes','E',()=>setPianoTool('select')],['Zoom','Z',()=>setPianoTool('zoom')],['Play selected / scrub','Y',()=>setPianoTool('playback')],['Mute notes','T',()=>setPianoTool('mute')],['Slide notes','S',()=>setPianoTool('slide')],null,['Select all notes','⌘A',()=>{clearPianoSelection();(pattern().notes[channel().id]||[]).forEach(n=>selectedNotes.add(n.id));renderPiano();}],['Clear selection','',()=>{clearPianoSelection();renderPiano();}],null,['Cut notes','⌘X',cutPianoNotes],['Copy notes','⌘C',copyPianoNotes],['Paste notes at visible bar','⌘V',()=>pastePianoNotes()],['Paste notes at cursor','',()=>pastePianoNotes({at:pianoCursor})],['Duplicate selection','⌘B',duplicatePianoNotes],['Clear this channel’s notes','',()=>$('#piano-clear').click()],['Ghost channels',pianoGhostsEnabled?'✓ Alt/Opt+V':'Alt/Opt+V',togglePianoGhosts],['Preview notes',pianoPreviewNotes?'✓':'',togglePianoPreviewNotes],null,['Slice notes at cursor','',()=>restructurePianoNotes('slice')],['Quick chop','⌘U',()=>restructurePianoNotes('chop')],['Glue touching notes','⌘G',()=>restructurePianoNotes('glue')],null,['Quick quantize start times','Shift+Q',quickQuantizePianoStarts],['Quantize…','Alt+Q',quantizePianoDialog],['Transpose up an octave','',()=>transformPianoNotes(notes=>PianoTools.transposeNotes(notes,12))],['Transpose down an octave','',()=>transformPianoNotes(notes=>PianoTools.transposeNotes(notes,-12))],['Legato','',()=>transformPianoNotes(notes=>PianoTools.legatoNotes(notes,patternLengthBeats(pattern())))],['Scale velocity…','',()=>textDialog('Piano roll velocity','Velocity multiplier (0–2)','1',v=>{if(+v>=0&&+v<=2)transformPianoNotes(notes=>PianoTools.scaleNoteVelocities(notes,+v));})]]);}
/** FL Mute (T) / Slide (S) tool click on a note: toggles the Freestyle `muted` / `slide`
 * note flag on it (or on the whole selection it belongs to) as ONE undoable score edit. */
function togglePianoNoteFlag(note,flag){
 engine.interacting=false;const p=pattern(),c=channel(),notes=p.notes[c.id]||[];if(!notes.some(item=>item.id===note.id))return false;
 const next=PianoTools.toggleNoteFlag(notes,flag,note.id,selectedNotes.has(note.id)?selectedNotes:null),changed=next.filter((item,index)=>item[flag]!==notes[index][flag]).length,on=note[flag]!==true;
 if(!changed)return false;const applied=edit(()=>{p.notes[c.id]=next;});
 if(applied)toast(`${flag==='muted'?(on?'Muted':'Unmuted'):(on?'Slide on':'Slide off')}: ${countLabel(changed,'note')}${flag==='slide'&&on?' (Freestyle stores slide; playback glides are not rendered yet)':''}.`);return applied;
}
function setPianoTool(value){if(!['draw','paint','erase','select','slice','zoom','playback','mute','slide','glue','velocity','finger','quantize'].includes(value))return;if(value==='finger'&&pianoTool!=='finger')toast('Finger Tool (F): drag a note sideways to change its length.');if(value==='quantize'&&pianoTool!=='quantize')toast('Quantize Tool (Q): click a note (or a selection) to quantize it to the Time Quantize value.');if(value==='mute'&&pianoTool!=='mute')toast('Mute tool (T): click a note to mute or unmute it (a selected note toggles the selection).');if(value==='slide'&&pianoTool!=='slide')toast('Slide tool (S): click a note to toggle its slide flag.');activeRackCancel?.();activePianoCancel?.();pianoTool=value;noteProperties?.syncScope();$('#piano').dataset.pianoTool=value;for(const [id,kind]of [['piano-draw','draw'],['piano-paint','paint'],['piano-erase','erase'],['piano-select','select'],['piano-slice','slice'],['piano-zoom','zoom'],['piano-playback','playback'],['piano-mute','mute'],['piano-slide','slide']])$('#'+id)?.classList.toggle('selected',value===kind);syncPianoToolMenus();}
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
/** Logic Z in the Piano Roll: zoom to fit the selected notes (or all notes); Z again returns to the previous view. */
function fitPianoView(){
 const viewport=$('#piano-scroll'),width=viewport.clientWidth-PIANO_KEY_WIDTH,height=viewport.clientHeight-PIANO_RULER_HEIGHT;if(width<=0||height<=0)return false;
 const all=pattern().notes[channel().id]||[],notes=selectedNotes.size?all.filter(note=>selectedNotes.has(note.id)):all,before=pianoView(),scope=pianoViewScope();
 if(pianoZoomPrevious?.scope===scope&&pianoZoomPrevious.fit){const view=pianoZoomPrevious.view;pianoZoomPrevious=null;applyPianoView(view);return true;}
 if(!notes.length){toast('Zoom to fit: there are no notes in this region.');return false;}
 const start=Math.min(...notes.map(note=>note.start)),end=Math.max(...notes.map(note=>note.start+note.duration)),high=Math.max(...notes.map(note=>note.pitch)),low=Math.min(...notes.map(note=>note.pitch));
 const scale=Math.max(pianoViewport.min,Math.min(pianoViewport.max,width*4/Math.max(.25,(end-start)*1.08))),rowHeight=Math.max(8,Math.min(34,Math.floor(height/(high-low+3))));
 pianoZoomPrevious={scope,view:before,fit:true};applyPianoView({scale,rowHeight,scrollLeft:Math.max(0,start/4*scale-width*.03),scrollTop:Math.max(0,(127-high-1)*rowHeight)});return true;
}
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
 const current=project,p=pattern(),c=channel(),notes=p.notes[c.id]||[],version=engine.loadVersion,contextVersion=engine.session.contextVersion,grid=$('#piano-grid'),rect=grid.getBoundingClientRect(),scale=pianoBarWidth,shownRow=(event.clientY-rect.top)/pianoRowHeight,from={beat:(event.clientX-rect.left)/scale*4,row:pianoFullRow(shownRow)},snap=event.altKey?0:pianoSnap(),minimum=pianoMinimumNote(p),children=new Map(),reserved=new Set(Object.values(p.notes||{}).flat().flatMap(note=>[String(note.id),String(note.cloudRaw?.id??'')])),nodes=new Map($$('.piano-note[data-note]').map(node=>[node.dataset.note,node])),visibility=new Map([...nodes].map(([id,node])=>[id,node.style.visibility]));
 const layer=document.createElement('div');layer.className='piano-slice-layer';layer.setAttribute('aria-hidden','true');layer.style.cssText='position:absolute;inset:0;pointer-events:none;z-index:6';grid.append(layer);
 const idForNote=id=>{if(!children.has(id)){let next;do{next=crypto.randomUUID();}while(reserved.has(next));reserved.add(next);children.set(id,next);}return children.get(id);},blur=()=>activePianoCancel?.();let errorMessage='';
 const compute=({deltaX,deltaY})=>{const shownTo=shownRow+deltaY/pianoRowHeight,to={beat:from.beat+deltaX/scale*4,row:pianoFullRow(shownTo)};try{return{...slicePianoLine(notes,{from,to,snapBeats:snap,minDuration:minimum,idForNote}),shown:[shownRow,shownTo]};}catch(error){if(errorMessage!==error.message){errorMessage=error.message;toast(error.message);}return{notes,cuts:[],from,to,shown:[shownRow,shownTo]};}};
 pianoGesture({element:grid,event,viewport:$('#piano-scroll'),initial:{notes,cuts:[],from,to:from},compute,changed:(_before,after)=>after.cuts.length>0,isValid:()=>pianoScope(current,p,c,notes,version)&&engine.session.contextVersion===contextVersion&&pianoTool==='slice'&&engine.ready&&!engine.loading&&!engine.applying&&!workspaceBusy()&&!rangeBusy()&&!sliceBusy()&&!cloudLibrary?.writeBusy,paint:state=>{const ids=new Set(state.cuts.map(cut=>cut.noteId)),fragmentIds=new Set(state.cuts.flatMap(cut=>[cut.noteId,cut.childId]));for(const [id,node]of nodes)node.style.visibility=ids.has(id)?'hidden':visibility.get(id);const [rowA,rowB]=state.shown||[shownRow,shownRow],x=state.from.beat/4*scale,y=rowA*pianoRowHeight,dx=(state.to.beat-state.from.beat)/4*scale,dy=(rowB-rowA)*pianoRowHeight;layer.innerHTML=`<div class="piano-slice-line" style="position:absolute;left:${x}px;top:${y}px;width:${Math.hypot(dx,dy)}px;border-top:1px solid #e8f6ba;transform-origin:0 0;transform:rotate(${Math.atan2(dy,dx)}rad)"></div>`+state.notes.filter(note=>fragmentIds.has(note.id)).map(note=>`<div class="piano-note piano-slice-preview" style="left:${note.start/4*scale}px;top:${pianoTop(note.pitch)}px;width:${note.duration/4*scale}px">${flNoteName(note.pitch)}</div>`).join('');},restore:()=>{layer.remove();for(const [id,node]of nodes)node.style.visibility=visibility.get(id);window.removeEventListener('blur',blur);},commit:state=>edit(()=>{p.notes[c.id]=state.notes;clearPianoSelection();for(const cut of state.cuts){selectedNotes.add(cut.noteId);selectedNotes.add(cut.childId);}selectedNote=selectedNotes.values().next().value||null;pianoCursor=state.cuts[0]?.beat??pianoCursor;})});window.addEventListener('blur',blur,{once:true});
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
 const drop=()=>{clearTimeout(cap);cap=null;const held=lease;lease=null;try{held?.release();}catch(error){report(error);}};
 return{
  play(next){if(done||!Number.isInteger(next)||next<0||next>127||next===pitch)return;pitch=next;
   if(sample){engine.preview(c,next).catch(report);return;}
   drop();try{lease=engine.acquireInstrumentNote(c,next,level);since=performance.now();Promise.resolve(lease.ready).catch(report);cap=setTimeout(drop,PIANO_PREVIEW_MAX_MS);}catch(error){lease=null;report(error);}},
  stop(){if(done)return;done=true;if(!lease)return;const wait=PIANO_PREVIEW_MIN_MS-(performance.now()-since);if(wait<=0)drop();else{clearTimeout(cap);cap=setTimeout(drop,wait);}},
 };
}
function togglePianoPreviewNotes(){pianoPreviewNotes=!pianoPreviewNotes;toast(`Preview notes ${pianoPreviewNotes?'on':'off'}`);}
function paintMidiKeys(pitches=midiInput?.pitches()||new Set()){for(const key of $$('#piano-keys .piano-key'))key.classList.toggle('midi-active',pitches.has(+key.dataset.pitch));}
function pianoDraw(event,{pitch,start}){
 if(event.isPrimary===false||event.button!==0)return false;event.preventDefault();event.stopPropagation();activePianoCancel?.();if(!playlistEditable())return false;
 const current=project,p=pattern(),c=channel(),notes=p.notes[c.id]||[],version=engine.loadVersion,grid=$('#piano-grid'),scale=pianoBarWidth,rowHeight=pianoRowHeight,rect=grid.getBoundingClientRect(),originBeat=(event.clientX-rect.left)/scale*4,snapMode=pianoSnapMode,globalSnap=$('#snap').value,bypass=event.altKey,shiftAxis=!!event.shiftKey,duration=+$('#note-length').value,drawTool=pianoTool;// Pencil as left tool, or ⌘-click Pencil over any left tool
 if(!Number.isInteger(pitch)||pitch<0||pitch>127||!Number.isFinite(start)||start<0||!Number.isFinite(duration)||duration<=0)return false;
 const sourceIdentity=()=>JSON.stringify([c.id,c.patternId,c.sourceId,c.laneId,c.instrumentType,c.type,c.cloudSource||null,c.cloudRaw||null]),sourceBinding=sourceIdentity();
 const initial={id:uid(),pitch,start,duration,velocity:.8},preview=document.createElement('div');preview.className='piano-note piano-draw-preview';preview.dataset.note=initial.id;preview.setAttribute('aria-hidden','true');grid.append(preview);
 const audition=pianoNotePreview(c,initial.velocity),paint=note=>{preview.style.left=`${note.start/4*scale}px`;preview.style.top=`${pianoTop(note.pitch)}px`;preview.style.width=`${note.duration/4*scale}px`;preview.textContent=flNoteName(note.pitch);audition.play(note.pitch);};paint(initial);
 const valid=()=>pianoScope(current,p,c,notes,version)&&sourceIdentity()===sourceBinding&&pianoTool===drawTool&&pianoBarWidth===scale&&pianoRowHeight===rowHeight&&pianoSnapMode===snapMode&&$('#snap').value===globalSnap&&engine.ready&&!engine.loading&&!engine.editBlocked&&!sliceBusy()&&!cloudLibrary?.writeBusy;
 pianoGesture({element:grid,event,viewport:$('#piano-scroll'),initial,changed:()=>true,isValid:valid,compute:(delta,note)=>{const {deltaX,deltaY}=constrainDragAxis(delta,shiftAxis);return{...note,start:quantizePiano(originBeat+deltaX/scale*4,{bypass}),pitch:pianoRowsNow.shift(note.pitch,Math.round(deltaY/rowHeight))};},paint,restore:()=>{preview.remove();audition.stop();},commit:note=>{if(!valid())return;edit(()=>{p.notes[c.id]||=[];p.notes[c.id].push(note);growPatternForNotes(p,[note]);clearPianoSelection();selectedNotes.add(note.id);selectedNote=note.id;pianoCursor=note.start;});}});return true;
}
function rememberPianoLength(note){const value=String(note.duration),select=$('#note-length');if(!Number.isFinite(note.duration)||note.duration<=0)return;if(![...select.options].some(option=>option.value===value)){const option=document.createElement('option');option.value=value;option.textContent=`${Number(note.duration.toFixed(6))} beats`;option.dataset.authored='true';select.append(option);}select.value=value;}
function pianoStroke(event,{erase=false}={}){
 if(![0,2].includes(event.button))return;event.preventDefault();event.stopPropagation();activePianoCancel?.();if(!playlistEditable()){engine.interacting=false;return;}
 const current=project,p=pattern(),c=channel(),notes=p.notes[c.id]||[],version=engine.loadVersion,grid=$('#piano-grid'),viewport=$('#piano-scroll'),rect=grid.getBoundingClientRect(),scroll={left:viewport.scrollLeft,top:viewport.scrollTop},scale=pianoBarWidth,originalTool=pianoTool;
 const layer=document.createElement('div');layer.className='piano-stroke-layer';layer.setAttribute('aria-hidden','true');grid.append(layer);const nodes=new Map($$('[data-note],[data-velocity]').map(node=>[`${node.hasAttribute('data-note')?'note':'velocity'}:${node.dataset.note??node.dataset.velocity}`,node])),visibility=new Map([...nodes].map(([id,node])=>[id,node.style.visibility]));
 let finished=false,physical={clientX:event.clientX,clientY:event.clientY,pointerId:event.pointerId};const matches=sample=>sample?.pointerId==null||sample.pointerId===event.pointerId,toPoint=sample=>({beat:(sample.clientX-rect.left+viewport.scrollLeft-scroll.left)/scale*4,row:pianoFullRow((sample.clientY-rect.top+viewport.scrollTop-scroll.top)/pianoRowHeight)});
 const valid=()=>pianoScope(current,p,c,notes,version)&&pianoTool===originalTool&&engine.ready&&!engine.loading&&!engine.editBlocked&&!sliceBusy()&&!cloudLibrary?.writeBusy;
 const restore=()=>{layer.remove();for(const [id,node]of nodes)node.style.visibility=visibility.get(id);};
 let stroke;try{stroke=new PianoStroke({notes,mode:erase?'erase':'paint',length:+$('#note-length').value,snapBeats:event.altKey?0:pianoSnap(),source:{...c.sourceId?{sourceId:c.sourceId}:{},channelId:c.id},isValid:valid,restore,onInvalid:()=>finish(true),paint:state=>{layer.innerHTML=state.created.map(note=>`<div class="piano-note piano-stroke-preview" style="left:calc(${note.start/4} * var(--bar));top:${pianoTop(note.pitch)}px;width:calc(${note.duration/4} * var(--bar))"></div>`).join('');for(const id of state.erased){const note=nodes.get(`note:${id}`),bar=nodes.get(`velocity:${id}`);if(note)note.style.visibility='hidden';if(bar)bar.style.visibility='hidden';}}});}catch(error){restore();engine.interacting=false;fail(error);return;}
 const autoscroll=new PlaylistAutoScroll({viewport,pointerId:event.pointerId,getInsets:()=>({left:PIANO_KEY_WIDTH,top:PIANO_RULER_HEIGHT}),isValid:valid,onScroll:()=>{try{stroke.addPoint(toPoint(physical));}catch(error){finish(true);fail(error);}}});
 const finish=(cancel,sample)=>{if(finished||!matches(sample))return;finished=true;autoscroll.destroy();activePianoCancel=null;grid.onpointermove=grid.onpointerup=grid.onpointercancel=grid.onlostpointercapture=null;try{if(grid.hasPointerCapture?.(event.pointerId))grid.releasePointerCapture(event.pointerId);}catch{}let result;try{result=stroke.finish(Number.isFinite(sample?.clientX)&&Number.isFinite(sample?.clientY)?toPoint(sample):toPoint(physical),{cancel});}catch(error){stroke.finish(undefined,{cancel:true});engine.interacting=false;fail(error);return;}engine.interacting=false;if(!result.changed)return;p.notes[c.id]=result.notes;clearPianoSelection();for(const note of result.created)selectedNotes.add(note.id);selectedNote=selectedNotes.values().next().value||null;growPatternForNotes(p,result.notes);changed();};
 activePianoCancel=Object.assign(()=>finish(true),{pointerId:event.pointerId});engine.interacting=true;try{grid.setPointerCapture(event.pointerId);}catch{}
 grid.onpointermove=sample=>{if(!matches(sample)||!Number.isFinite(sample?.clientX)||!Number.isFinite(sample?.clientY))return;physical={clientX:sample.clientX,clientY:sample.clientY,pointerId:event.pointerId};try{stroke.addPoint(toPoint(physical));autoscroll.update(physical);}catch(error){finish(true);fail(error);}};grid.onpointerup=sample=>finish(false,sample);grid.onpointercancel=grid.onlostpointercapture=sample=>finish(true,sample);
 try{stroke.addPoint(toPoint(physical));autoscroll.update(physical,{enabled:false});}catch(error){finish(true);fail(error);}
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
 // Collapse Mode: rows = the pitches that contain notes (all 128 when off or when the region is empty).
 const rows=pianoRowsNow=pianoRowModel(notes,{collapsed:pianoCollapsed}),rowCount=rows.count,rowPitch=i=>rows.pitchAt(i);$('#piano').classList.toggle('piano-collapsed',rows.collapsed);grid.dataset.rows=String(rowCount);
 setMarkupIfChanged($('#piano-keys'),Array.from({length:rowCount},(_,i)=>{const pitch=rowPitch(i);return `<div class="piano-key ${[1,3,6,8,10].includes(pitch%12)?'black':''}" data-pitch="${pitch}" title="${flNoteName(pitch)} · MIDI ${pitch}"><span>${rows.collapsed||pitch%12===0?flNoteName(pitch):''}</span></div>`;}).join(''));
 grid.innerHTML=Array.from({length:rowCount},(_,i)=>[1,3,6,8,10].includes(rowPitch(i)%12)?`<div class="piano-grid-row" style="top:${i*pianoRowHeight}px"></div>`:'').join('')+(rows.collapsed?'':pianoGhostMarkup(p,c.id,{enabled:pianoGhostsEnabled,rowHeight:pianoRowHeight}))+notes.filter(n=>Number.isInteger(n.pitch)&&n.pitch>=0&&n.pitch<=127).map(n=>`<div class="piano-note ${selectedNotes.has(n.id)?'selected':''}${n.muted===true?' muted':''}${n.slide===true?' slide':''}${n.duration<.5?' short':''}" data-note="${esc(n.id)}"${n.muted===true||n.slide===true?` title="${[n.muted===true?'Muted note':'',n.slide===true?'Slide note':''].filter(Boolean).join(' · ')}"`:''} style="left:calc(${n.start/4} * var(--bar));top:${pianoTop(n.pitch)}px;width:calc(${n.duration/4} * var(--bar));--note-color:${logicVelocityColor(n.velocity)}" data-midi-velocity="${midiVelocity(n.velocity)}">${flNoteName(n.pitch)}${n.slide===true?'<span class="note-slide" aria-hidden="true"></span>':''}<div class="note-resize"></div></div>`).join('');
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
  const rect=grid.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top,pitch=pianoPitchAtY(y),start=quantizePiano(x/pianoBarWidth*4,{bypass:e.altKey});pianoCursor=start;
  // Pointer (and the note-only Velocity/Glue tools) on empty space: drag = marquee, click = deselect.
  if(e.ctrlKey||e.shiftKey||['select','velocity','glue','finger','quantize'].includes(active)){
   const initial=e.shiftKey?new Set(selectedNotes):new Set(),box=document.createElement('div'),current=project,version=engine.loadVersion;box.className='piano-selection-box';grid.append(box);
   const rectAtStart=grid.getBoundingClientRect(),origin={x:e.clientX-rectAtStart.left,y:e.clientY-rectAtStart.top},draw=point=>{box.style.cssText=`left:${Math.min(origin.x,point.x)}px;top:${Math.min(origin.y,point.y)}px;width:${Math.abs(point.x-origin.x)}px;height:${Math.abs(point.y-origin.y)}px`;};
   pianoGesture({element:grid,event:e,viewport:$('#piano-scroll'),initial:origin,compute:({deltaX,deltaY})=>({x:origin.x+deltaX,y:origin.y+deltaY}),paint:draw,restore:()=>box.remove(),isValid:()=>pianoScope(current,p,c,notes,version),changed:()=>true,commit:point=>{clearPianoSelection();initial.forEach(id=>selectedNotes.add(id));const left=Math.min(origin.x,point.x),right=Math.max(origin.x,point.x),upper=Math.min(origin.y,point.y),lower=Math.max(origin.y,point.y);if(left!==right&&upper!==lower)for(const n of notes){const nx=n.start/4*pianoBarWidth,ny=pianoRowsNow.rowOf(n.pitch)*pianoRowHeight;if(nx+n.duration/4*pianoBarWidth>left&&nx<right&&ny+pianoRowHeight>upper&&ny<lower)selectedNotes.add(n.id);}selectedNote=selectedNotes.values().next().value||null;renderPiano();}});return;
  }
  if(active==='paint')return pianoStroke(e);
  // Mute / Slide tools act on notes only; an empty-grid click just moves the cursor.
  if(active==='mute'||active==='slide'){engine.interacting=false;return;}
  if(active!=='draw'){engine.interacting=false;return;}
  return pianoDraw(e,{pitch,start});
 };
 grid.oncontextmenu=e=>pianoContextMenu(e,null);
 // Gestures own grid.onpointermove; the header readout listens separately.
 if(!grid.dataset.positionReadout){grid.dataset.positionReadout='1';grid.addEventListener('pointermove',e=>{const bounds=grid.getBoundingClientRect(),pitch=pianoPitchAtY(e.clientY-bounds.top),beat=Math.max(0,(e.clientX-bounds.left)/pianoBarWidth*4),readout=$('#piano-position');if(readout&&Number.isFinite(beat))readout.textContent=logicPositionReadout(pitch>=0&&pitch<=127?pitch:null,beat);});}
 $$('#piano .piano-note').forEach(el=>{el.onpointerdown=e=>noteDrag(e,el);el.ondblclick=e=>{e.preventDefault();e.stopPropagation();if(['zoom','playback'].includes(pianoTool))return;/* Logic: double-clicking a note with the Pointer deletes it; the Pencil never deletes (Quick Help TOO_005: "Create a region or event, or use to edit its length"). Note Properties stays on ⌥-double-click, on the other tools and in the context menu. */if(pianoTool==='select'&&!e.metaKey&&!e.shiftKey&&!e.altKey&&!e.ctrlKey){const id=el.dataset.note,p=pattern(),c=channel();if(!playlistEditable()||!(p.notes[c.id]||[]).some(note=>note.id===id))return;edit(()=>{p.notes[c.id]=p.notes[c.id].filter(note=>note.id!==id);selectedNotes.delete(id);if(selectedNote===id)selectedNote=selectedNotes.values().next().value||null;});return;}try{openNoteProperties(el.dataset.note);}catch(error){fail(error);}};el.oncontextmenu=e=>pianoContextMenu(e,el.dataset.note);});
 syncPianoInspector();
 $('#velocity-grid').innerHTML=notes.map(n=>`<div class="velocity-bar ${selectedNotes.has(n.id)?'selected':''}${n.muted===true?' muted':''}" data-velocity="${esc(n.id)}" style="left:calc(${n.start/4} * var(--bar));height:${n.velocity*pianoVelocityRange()}px" title="Velocity ${Math.round(n.velocity*100)}%"></div>`).join('');
 $$('#piano [data-velocity]').forEach(el=>{el.onpointerdown=e=>velocityDrag(e,el);});
 const totalBars=Math.max(16,Math.ceil(patternLengthBeats(p)/4)+4);$('#piano .piano-grid-wrap').style.width=`calc(${PIANO_KEY_WIDTH}px + ${totalBars} * var(--bar))`;$('#piano .piano-grid-wrap').style.height=`${rowCount*pianoRowHeight+PIANO_RULER_HEIGHT}px`;grid.style.height=`${rowCount*pianoRowHeight}px`;
 pianoTarget=target;if(pianoNeedsFocus&&!$('#piano').classList.contains('hidden')){const high=notes.length?Math.max(...notes.map(n=>n.pitch)):72;$('#piano-scroll').scrollTop=rows.collapsed?0:Math.max(0,(127-Math.min(127,high+5))*pianoRowHeight);pianoNeedsFocus=false;}$('#piano-scroll').onscroll=()=>{$('#velocity-grid').scrollLeft=$('#piano-scroll').scrollLeft;};if(notePropertiesPreview)paintNoteProperties(notePropertiesPreview);pianoNavigator?.refresh();
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
 const paint=state=>{for(const note of state){const node=previews.get(note.id);node.style.left=`${note.start/4*scale}px`;node.style.top=`${pianoTop(note.pitch)}px`;node.style.width=`${note.duration/4*scale}px`;node.textContent=flNoteName(note.pitch);}};paint(clones);
 const valid=()=>pianoScope(current,p,c,notes,version)&&sourceIdentity()===sourceBinding&&JSON.stringify(notes)===scoreIdentity&&pianoTool===tool&&pianoBarWidth===scale&&pianoRowHeight===rowHeight&&pianoSnapMode===snapMode&&$('#snap').value===globalSnap&&engine.ready&&!engine.loading&&!engine.editBlocked&&!sliceBusy()&&!cloudLibrary?.writeBusy;
 pianoGesture({element,event,viewport:$('#piano-scroll'),initial:clones,changed:()=>true,isValid:valid,compute:(delta,initial)=>{const {deltaX,deltaY}=constrainDragAxis(delta,!!event.shiftKey),rows=Math.round(deltaY/rowHeight);return pianoMovePitches(movePianoGesture(initial,{deltaBeats:deltaX/scale*4,deltaPitch:pianoRowsNow.collapsed?0:-rows,snapBeats:snap}),initial,rows);},paint,restore:()=>{layer.remove();for(const [node,wasSelected]of selection)node.classList.toggle('selected',wasSelected);},commit:state=>{if(!valid())return;edit(()=>{p.notes[c.id]=[...notes,...state];growPatternForNotes(p,state);clearPianoSelection();if(selected){for(const clone of state)selectedNotes.add(clone.id);selectedNote=state[0]?.id||null;}pianoCursor=state[group.indexOf(note)]?.start??note.start;});}});
}
function noteDrag(e,el){
 if(e.isPrimary===false)return;
 if(pianoZoomRequest(e))return pianoZoom(e);
  if(pianoScrubRequest(e))return pianoScrub(e);
 // Logic: right-click opens the context menu (contextmenu event); it never erases a note.
 if(e.button!==0)return;
 const active=logicEffectiveTool(e,{tool:pianoTool,commandTool:pianoCommandTool}),plain=!e.ctrlKey&&!e.shiftKey&&!e.altKey,/* Logic's Finger tool changes the length from anywhere on the note */edge=e.target.classList.contains('note-resize')||active==='finger';
 if(active==='slice'&&plain)return pianoTool==='slice'?pianoSlice(e):undefined;
 e.stopPropagation();activePianoCancel?.();const p=pattern(),c=channel(),notes=p.notes[c.id]||[],n=notes.find(n=>n.id===el.dataset.note);if(!n)return;
 if(active==='erase'&&!e.ctrlKey&&!e.shiftKey)return pianoStroke(e,{erase:true});
 if(active==='paint'&&plain&&!edge){rememberPianoLength(n);return pianoStroke(e);}
 if((active==='mute'||active==='slide')&&plain){e.preventDefault();return togglePianoNoteFlag(n,active==='mute'?'muted':'slide');}
 if(active==='velocity'&&plain)return pianoVelocityTool(e,el,n);
 if(active==='quantize'&&plain){e.preventDefault();engine.interacting=false;if(!selectedNotes.has(n.id)){clearPianoSelection();selectedNotes.add(n.id);selectedNote=n.id;}return quantizePianoSelection();}
 if(active==='glue'&&plain){e.preventDefault();engine.interacting=false;if(!selectedNotes.has(n.id)||selectedNotes.size<2)return toast('Glue Tool: select the touching notes, then click one of them.');return restructurePianoNotes('glue');}
 rememberPianoLength(n);
 // Logic: Shift-click toggles a note in the selection (Ctrl kept for non-Mac keyboards).
 // Ctrl+Shift-drag moves without snapping (Logic's fine adjustment).
 const fine=e.ctrlKey&&e.shiftKey;
 const toggleNote=()=>{selectedNotes.has(n.id)?selectedNotes.delete(n.id):selectedNotes.add(n.id);selectedNote=selectedNotes.values().next().value||null;engine.interacting=false;renderPiano();};
 if(!fine&&e.ctrlKey){toggleNote();return;}
 // Logic: ⇧-click toggles the note in the selection; ⇧-drag moves it limited to one direction (time or pitch).
 const shiftAxis=!!(e.shiftKey&&!fine&&!edge&&!e.altKey),wasSelected=selectedNotes.has(n.id);
 if(shiftAxis&&!playlistEditable()){toggleNote();return;}
 // Logic: Option-drag copies.
 if(e.altKey&&!edge)return pianoCloneDrag(e,el,p,c,notes,n);
 if(!playlistEditable()){engine.interacting=false;return;}
 if(!selectedNotes.has(n.id)){if(!shiftAxis)clearPianoSelection();selectedNotes.add(n.id);}selectedNote=n.id;pianoCursor=n.start;
 const current=project,version=engine.loadVersion,group=notes.filter(n=>selectedNotes.has(n.id)),initialById=new Map(group.map(note=>[note.id,note])),resizing=edge,elements=new Map($$('#piano .piano-note').map(node=>[node.dataset.note,node])),styles=new Map([...elements].map(([id,node])=>[id,node.style.cssText]));
 for(const [id,node]of elements)node.classList.toggle('selected',selectedNotes.has(id));
 const audition=resizing?pianoNotePreview(null):pianoNotePreview(c,n.velocity);if(!shiftAxis)audition.play(n.pitch);// a ⇧-press may be a selection click: it sounds only once it moves
 pianoGesture({element:el,event:e,viewport:$('#piano-scroll'),initial:group,/* ⇧-click without a drag: toggle (a note this press added stays selected) */click:shiftAxis?()=>{if(wasSelected)toggleNote();else renderPiano();}:null,compute:(delta,initial)=>{const {deltaX,deltaY}=constrainDragAxis(delta,shiftAxis),rows=Math.round(deltaY/pianoRowHeight),moved=movePianoGesture(initial,{deltaBeats:deltaX/pianoBarWidth*4,deltaPitch:pianoRowsNow.collapsed?0:-rows,snapBeats:e.altKey||fine?0:pianoSnap(),resize:resizing,minDuration:pianoMinimumNote(p)});return resizing?moved:pianoMovePitches(moved,initial,rows);},paint:state=>{for(const update of state){const node=elements.get(update.id);if(!node)continue;if(resizing)node.style.width=`${update.duration/4*pianoBarWidth}px`;else node.style.transform=`translate3d(${(update.start-initialById.get(update.id).start)/4*pianoBarWidth}px,${(pianoRowsNow.rowOf(update.pitch)-pianoRowsNow.rowOf(initialById.get(update.id).pitch))*pianoRowHeight}px,0)`;}const lead=state.find(update=>update.id===n.id);if(lead)audition.play(lead.pitch);},restore:()=>{for(const [id,node]of elements)node.style.cssText=styles.get(id);audition.stop();},isValid:()=>pianoScope(current,p,c,notes,version),commit:state=>{const updates=new Map(state.map(n=>[n.id,n]));p.notes[c.id]=notes.map(note=>updates.get(note.id)||note);growPatternForNotes(p,state);changed();
  // FL: a resized note's length becomes the length of the next drawn note.
  if(resizing){const lead=updates.get(n.id);if(lead)rememberPianoLength(lead);}}});
}
function velocityDrag(e,el){
 if(e.button!==0)return;e.stopPropagation();activePianoCancel?.();if(!playlistEditable()){engine.interacting=false;return;}const current=project,version=engine.loadVersion,p=pattern(),c=channel(),notes=p.notes[c.id]||[],note=notes.find(n=>n.id===el.dataset.velocity);if(!note){engine.interacting=false;return;}const group=selectedNotes.has(note.id)?notes.filter(n=>selectedNotes.has(n.id)):[note],bars=new Map($$('#piano [data-velocity]').map(node=>[node.dataset.velocity,node])),heights=new Map([...bars].map(([id,node])=>[id,node.style.height]));
 pianoGesture({element:el,event:e,initial:group,compute:({deltaY},initial)=>velocityPianoGesture(initial,-deltaY/pianoVelocityRange()),paint:state=>{for(const update of state){const bar=bars.get(update.id);if(bar)bar.style.height=`${update.velocity*pianoVelocityRange()}px`;}},restore:()=>{for(const [id,node]of bars)node.style.height=heights.get(id);},isValid:()=>pianoScope(current,p,c,notes,version),commit:state=>{const updates=new Map(state.map(n=>[n.id,n]));p.notes[c.id]=notes.map(n=>updates.get(n.id)||n);changed();}});
}
// ---- Logic Piano Roll: Velocity tool, context menu, local inspector, tool and local menus ----
// Every score change below goes through the existing edit()/transformPianoNotes() history path.
const pianoQuantize={grid:'1/16',strength:100,swing:50,scaleRoot:'Off',scale:'Major (Ionian)'};
function pianoVelocityTool(e,el,note){
 e.preventDefault();if(!playlistEditable()){engine.interacting=false;return;}
 const current=project,version=engine.loadVersion,p=pattern(),c=channel(),notes=p.notes[c.id]||[],tool=pianoTool,group=selectedNotes.has(note.id)?notes.filter(n=>selectedNotes.has(n.id)):[note];
 const nodes=new Map($$('#piano .piano-note[data-note]').map(node=>[node.dataset.note,node])),bars=new Map($$('#piano [data-velocity]').map(node=>[node.dataset.velocity,node])),noteStyles=new Map([...nodes].map(([id,node])=>[id,[node.style.cssText,node.dataset.midiVelocity]])),barStyles=new Map([...bars].map(([id,node])=>[id,node.style.cssText])),readout=$('#piano-position'),before=readout?.textContent??'';
 // Logic Velocity tool: drag up/down; about one MIDI velocity step per pixel.
 pianoGesture({element:el,event:e,initial:group,compute:({deltaY},initial)=>velocityPianoGesture(initial,-deltaY/127),paint:state=>{for(const update of state){const node=nodes.get(update.id);if(node){node.style.setProperty('--note-color',logicVelocityColor(update.velocity));node.dataset.midiVelocity=String(midiVelocity(update.velocity));}const bar=bars.get(update.id);if(bar)bar.style.height=`${update.velocity*pianoVelocityRange()}px`;}const lead=state.find(update=>update.id===note.id);if(lead&&readout)readout.textContent=`Velocity ${midiVelocity(lead.velocity)}`;},restore:()=>{for(const [id,node]of nodes){const [css,velocity]=noteStyles.get(id);node.style.cssText=css;if(velocity!==undefined)node.dataset.midiVelocity=velocity;}for(const [id,node]of bars)node.style.cssText=barStyles.get(id);if(readout)readout.textContent=before;},isValid:()=>pianoScope(current,p,c,notes,version)&&pianoTool===tool,commit:state=>{const updates=new Map(state.map(n=>[n.id,n]));p.notes[c.id]=notes.map(n=>updates.get(n.id)||n);changed();}});
}
function selectAllPianoNotes(){activePianoCancel?.();clearPianoSelection();(pattern().notes[channel().id]||[]).forEach(n=>selectedNotes.add(n.id));selectedNote=selectedNotes.values().next().value||null;renderPiano();}
function deletePianoSelection(){if(!selectedNotes.size)return false;const p=pattern(),id=channel().id,ids=new Set(selectedNotes);return edit(()=>{p.notes[id]=(p.notes[id]||[]).filter(n=>!ids.has(n.id));clearPianoSelection();});}
/** Q: Logic Time Quantize (grid, Strength, Swing) on the selection (or the whole region with none). */
function quantizePianoSelection(){
 if(activeEditor()!=='piano'||$('#piano').classList.contains('hidden'))return false;
 if(!coreFileEditable()||activePianoCancel||activePlaylistCancel||activeRackCancel||windows.dragging||windows.pending)return toast('Finish the current edit before quantizing.'),false;
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
 // ⌃⇧-drag is the fine (unsnapped) drag: the Mac "Control-click" context event it also raises opens no menu.
 if(e.ctrlKey&&e.shiftKey&&e.button!==2)return;
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
 menu({clientX:bounds.left,clientY:bounds.bottom},LOGIC_PIANO_TOOLS.map(tool=>({label:tool.label,shortcut:command?'':tool.key,checked:tool.id===current,disabled:!!tool.unsupported,title:tool.unsupported||'',run:()=>{if(command){pianoCommandTool=tool.id;syncPianoToolMenus();}else setPianoTool(tool.id);}})));
}
function pianoLocalMenu(event,kind){
 activePianoCancel?.();const bounds=(event.currentTarget||event.target).getBoundingClientRect(),at={clientX:bounds.left,clientY:bounds.bottom},none=!selectedNotes.size;
 const why=none?'Select one or more notes first.':'',off=(label,title,shortcut='')=>({label,shortcut,disabled:true,title}),key=(label,shortcut,name,args=[],needs=true)=>({label,shortcut,run:()=>logicKeyCommand(name,args),disabled:needs&&none,title:needs?why:''}),ends=(label,shortcut,options)=>({label,shortcut,run:()=>logicTrimNoteEnds(options),disabled:none,title:why}),transpose=(label,shortcut,amount)=>({label,shortcut,run:()=>transformPianoNotes(notes=>PianoTools.transposeNotes(notes,amount)),disabled:none,title:why}),piano=$('#piano'),colour=piano.dataset.noteColor||'velocity';
 // Logic's Piano Roll local menus (Quick Help PRM_001…045 name the commands; unsupported ones stay listed with the reason).
 const items={
  edit:[['Undo','⌘Z',()=>undo(),!historyAvailable('undo'),historyAvailable('undo')?'':'There is nothing to undo.'],['Redo','⇧⌘Z',()=>redo(),!historyAvailable('redo'),historyAvailable('redo')?'':'There is nothing to redo.'],['Undo History…','⌃⌥⌘Z',()=>undoHistoryDialog()],off('Delete Undo History…','The session history is cleared when the project is reloaded.'),null,
   ['Cut','⌘X',cutPianoNotes,none],['Copy','⌘C',copyPianoNotes,none],['Paste','⌘V',()=>pastePianoNotes({at:pianoCursor}),!pianoClipboard],off('Paste Replace','Paste always adds; delete the old notes first.','⇧⌘V'),['Delete','⌫',deletePianoSelection,none],['Select All','⌘A',selectAllPianoNotes],
   {label:'Select',submenu:[key('All Following','⇧F','select-following'),key('All Following of Same Pitch','⌃⇧F','select-following',['same']),off('All Inside Locators','Applies to regions in the Tracks area.','⇧L'),key('Overlapped Notes','⇧O','select-overlapped',[],false),key('Muted Notes','⇧M','select-muted',[],false),key('Equal Notes','⇧E','select-equal'),key('Similar Notes','⇧S','select-equal'),off('Same MIDI Channel','Notes carry no separate MIDI channel in Freestyle patterns.','⇧H'),key('Same Subposition','⇧P','select-same-subposition'),off('Same Articulation ID','Freestyle notes have no articulation IDs.','⇧A'),key('Highest Notes','⇧↑','select-pitch-edge',['high'],false),key('Lowest Notes','⇧↓','select-pitch-edge',['low'],false),null,key('Invert Selection','⇧I','invert-selection',[],false),key('Deselect All','⇧D','deselect-all',[],false)]},null,
   {label:'Split',submenu:[['Notes at Playhead','⌘T',()=>logicKeyCommand('split-notes-at-playhead')],off('Notes at Rounded Playhead Position','Move the playhead to a bar or beat (, .), then split (⌘T).')]},
   {label:'Join',submenu:[['Notes','⌘J',()=>restructurePianoNotes('glue'),selectedNotes.size<2,'Select two or more touching notes first.']]},['Repeat','⌘R',duplicatePianoNotes,none],null,
   {label:'Move',submenu:[key('To Playhead',';','move-notes-to-playhead')]},
   {label:'Trim',submenu:[ends('Note End to Remove Overlaps to Selected Notes','',{pool:'selected',force:false,gap:8}),ends('Note End to Remove Overlaps to Following Notes','\\',{pool:'all',force:false,gap:8}),ends('Note End to Remove Overlaps to Repeated Notes','',{pool:'pitch',force:false,gap:8}),null,key('Note Start to Playhead','⌘[','trim-notes-to-playhead',['start']),key('Note End to Playhead','⌘]','trim-notes-to-playhead',['end']),null,ends('Note End to Selected Notes (Force Legato)','',{pool:'selected',force:true,gap:8}),ends('Note End to Following Notes (Force Legato)','⇧\\',{pool:'all',force:true,gap:8}),ends('Note End to Selected Notes (4 Ticks Overlap)','',{pool:'selected',force:true,gap:-4}),ends('Note End to Following Notes (4 Ticks Overlap)','',{pool:'all',force:true,gap:-4})]},
   {label:'Transpose',submenu:[transpose('+1 Semitone','⌥↑',1),transpose('-1 Semitone','⌥↓',-1),transpose('+12 Semitones','⌥⇧↑',12),transpose('-12 Semitones','⌥⇧↓',-12)]},null,
   off('Toggle Time Handles','There are no time handles; drag note edges or use Trim.','⌃T'),off('Define Brush Pattern','The Brush tool paints single notes; it has no pattern.','⌃⇧B'),off('Reset Brush Pattern','The Brush tool paints single notes; it has no pattern.','⌃⇧⌫')],
  functions:[{label:`Quantize Notes (${LOGIC_TIME_QUANTIZE.find(item=>item.id===pianoQuantize.grid)?.label||'Off'})`,shortcut:'Q',run:quantizePianoSelection},off('Dequantize','Quantize rewrites note positions; use Undo (⌘Z) to get them back.','⌥⌘Q'),null,['Mute Notes On/Off','⌃M',toggleSelectedNotesMuted,none,why],null,
   {label:'MIDI Transform',submenu:[{label:'Humanize…',run:()=>openHumanizeDialog(dialog,{selection:selectedNotes.size,onApply:options=>transformPianoNotes(notes=>humanizeNotes(notes,options))})},off('Fixed Velocity','Set one velocity with the inspector’s Velocity slider.'),off('Double Speed','Not available; scale lengths with the note edges.'),off('Half Speed','Not available; scale lengths with the note edges.'),off('Reverse Position','Not available.'),off('Transposition','Use Edit ▸ Transpose.')]},null,
   off('Include Non-Note MIDI Events','Freestyle patterns hold notes only.'),off('Convert Sustain Pedal to Note Length','Freestyle patterns hold notes only; there are no pedal events.'),off('Set MIDI Channel to Voice Number','Notes carry no separate MIDI channel in Freestyle patterns.'),null,
   // Not Logic entries (kept last)
   ['Scale Quantize Selected Notes','',scaleQuantizePianoSelection,pianoQuantize.scaleRoot==='Off','Choose a Scale Quantize root in the inspector.'],['Quantize…','',quantizePianoDialog],['Chop Notes at Snap Value','',()=>restructurePianoNotes('chop'),none,why],['Note Properties…','',()=>openNoteProperties(selectedNote||[...selectedNotes][0]),none,why],['Clear Region Notes','',()=>$('#piano-clear').click()]],
  view:[{label:'Link',checked:true,disabled:true,title:'The Piano Roll always follows the selected region (Content Link).'},{label:'One Track',checked:true,disabled:true,title:'The Piano Roll shows the selected region’s track.'},off('Selected Regions','The Piano Roll shows one region at a time.'),null,
   {label:'Show Local Inspector',shortcut:'⌥⇧I',checked:!piano.classList.contains('hide-inspector'),run:()=>{piano.classList.toggle('hide-inspector');}},off('Drum Names','Freestyle instruments publish no drum names.'),{label:'Note Labels',checked:!piano.classList.contains('hide-note-labels'),run:()=>{piano.classList.toggle('hide-note-labels');}},off('Region Transpose','Freestyle regions carry no transpose value.'),
   {label:'Set Note Color',submenu:[{label:'By Region Color',checked:colour==='region',run:()=>{piano.dataset.noteColor='region';}},{label:'By Velocity',checked:colour==='velocity',run:()=>{piano.dataset.noteColor='velocity';}},off('By MIDI Channel','Notes carry no separate MIDI channel in Freestyle patterns.'),off('By Articulation','Freestyle notes have no articulation IDs.')]},off('Global Track Protect Buttons','Freestyle projects have no global tracks.'),off('Articulation ID','Freestyle notes have no articulation IDs.'),null,
   // Not Logic entries (kept last)
   {label:'Collapse Mode',checked:pianoCollapsed,run:()=>setPianoCollapsed(!pianoCollapsed)},{label:'Velocity Lane',checked:!piano.classList.contains('hide-velocity'),run:()=>{piano.classList.toggle('hide-velocity');renderPiano();}},{label:'Other Tracks’ Notes (Ghosts)',checked:pianoGhostsEnabled,shortcut:'⌥V',run:togglePianoGhosts}],
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
/* Trashlab Sounds ▸ Patterns: the project's patterns (name, length, mini step preview). Dragging one into a track
   places it (the same payload as the Drum Machine's own pattern list, so the lane drop code handles it); a click
   opens it in the Drum Machine drawer; "New Pattern" creates one and opens it. */
function editPatternInDrumMachine(id){if(!project.patterns.some(p=>p.id===id))return false;if(project.selectedPattern!==id)selectPattern(id);if(!$('#mixer')?.classList.contains('hidden'))toggleMixer(false);return openEditorPane('step');}
function newPatternInDrumMachine(){const before=project.selectedPattern;addPattern();const p=pattern();if(!p||p.id==='empty'||p.id===before)return null;editPatternInDrumMachine(p.id);return p;}
/** Add Track ▸ Drum Machine: a new empty pattern, opened in the Drum Machine drawer, then placed at bar 1 on a new
 * track. Two edits on purpose: the placement is made after the pattern is saved, exactly like dragging it from the
 * Patterns tab onto the row below the last track. (As with that drag, neither creating a pattern nor a placement that
 * creates its track is an Undo step in this app; the track menu's Delete Track removes it.)
 * Sounds are the drawer's own rows (its + button: a sample from disk or an instrument; the built-in drum rows only
 * where the connection offers them).
 * @returns {Promise<object|null>|null} null when nothing was started. */
function newDrumMachineTrack(){
 if(!engine.ready){openCloudPanel().catch(fail);return null;}
 const projectId=project.cloud?.projectId;let created=null;
 const applied=edit(()=>{const kept=project.patterns.filter(item=>item.id!=='empty'),taken=new Set(kept.map(item=>item.name));let n=kept.length+1;while(taken.has(`Pattern ${n}`))n++;const p={id:'local-'+uid(),name:`Pattern ${n}`,bars:1,steps:{},notes:{}};project.patterns=[...kept,p];project.selectedPattern=p.id;created=p;});
 if(applied!==true||!created)return null;
 editPatternInDrumMachine(created.id);
 return(async()=>{
  await engine.flush();const p=pattern();
  if(!engine.ready||project.cloud?.projectId!==projectId||!p||p.id==='empty'||p.name!==created.name)return null;// project or selection changed meanwhile: the pattern stays in the Patterns tab
  const placed=edit(()=>project.clips.push({id:uid(),patternId:p.id,track:logicRealTrackCount(),start:0,length:patternLengthBeats(p)}));
  if(placed!==true)return null;
  toast('Drum Machine track added. Add a sound row with + in the Drum Machine, then switch on steps.');return p;
 })();
}
function renderPatternsTab(){
 const tree=$('#browser-tree');if(!tree)return;
 const query=$('#browser-search').value.trim().toLowerCase(),all=project.patterns.filter(p=>p.id!=='empty'),shown=all.filter(p=>!query||String(p.name||'').toLowerCase().includes(query)),ready=!!project.cloud?.projectId;
 const rows=shown.map(p=>{const steps=Math.ceil(patternLengthBeats(p)*4),bars=steps/16,selected=p.id===project.selectedPattern;return `<div class="tl-pattern-item${selected?' selected':''}" role="option" tabindex="0" draggable="true" data-tl-pattern="${esc(p.id)}" data-library="pattern:${esc(p.id)}" aria-selected="${selected}" title="${esc(p.name)}: drag into a track to place it, click to edit it in the Drum Machine"><span class="tl-pattern-grip" aria-hidden="true"><svg viewBox="0 0 8 14"><circle cx="2" cy="2" r="1.2"/><circle cx="6" cy="2" r="1.2"/><circle cx="2" cy="7" r="1.2"/><circle cx="6" cy="7" r="1.2"/><circle cx="2" cy="12" r="1.2"/><circle cx="6" cy="12" r="1.2"/></svg></span><span class="tl-pattern-main"><b>${esc(p.name)}</b><small>${Number.isInteger(bars)?bars:bars.toFixed(2)} bar${bars===1?'':'s'} · ${steps} steps</small></span><span class="tl-pattern-preview">${patternSvg(p)}</span></div>`;}).join('');
 const empty=!all.length?`<p class="tl-patterns-empty">${ready?'No patterns yet. Create one, switch on some steps in the Drum Machine, then drag it into a track.':'Open a Freestyle project to make patterns.'}</p>`:!shown.length?'<p class="tl-patterns-empty">No pattern matches the search.</p>':'';
 if(!tree.querySelector('.tl-patterns'))tree.innerHTML='';// another browser view drew here since
 setMarkupIfChanged(tree,`<div class="tl-patterns"><div class="tl-patterns-head"><span>Project patterns</span><button type="button" class="tl-pattern-new"${ready?'':' disabled'} title="${ready?'Create an empty pattern and open it in the Drum Machine':'Open a Freestyle project first'}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>New Pattern</button></div><div class="tl-pattern-list" role="listbox" aria-label="Project patterns">${rows}</div>${empty}${all.length?'<p class="tl-patterns-hint">Drag a pattern into a track to place it. Click one to edit its steps.</p>':''}</div>`);
 for(const item of tree.querySelectorAll('[data-tl-pattern]')){const id=item.dataset.tlPattern;
  item.onclick=()=>editPatternInDrumMachine(id);item.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();editPatternInDrumMachine(id);}};
  item.ondragstart=e=>{e.dataTransfer.setData('application/vegetable-pattern',id);e.dataTransfer.effectAllowed='copy';item.classList.add('dragging');};item.ondragend=()=>item.classList.remove('dragging');
  item.oncontextmenu=e=>{e.preventDefault();patternMenu(e,id);};}
 const create=tree.querySelector('.tl-pattern-new');if(create)create.onclick=()=>newPatternInDrumMachine();
}
function renderLegacyBrowser(){if(browserTab==='patterns')return renderPatternsTab();const query=$('#browser-search').value.toLowerCase();let groups=library;if(browserTab==='plugins')groups=library.slice(1,3);if(browserTab==='patterns')groups=[['Patterns',project.patterns.map(p=>[p.name,'pattern:'+p.id])]];if(browserTab==='cloud')groups=library.slice(4);if(browserTab==='favorites')groups=library.slice(1,2);
 $('#browser-tree').innerHTML=groups.map(([name,items],i)=>{const matches=items.filter(([title])=>title.toLowerCase().includes(query)||name.toLowerCase().includes(query));if(!matches.length)return '';return `<div class="browser-folder" data-folder="${esc(name)}"><span>${closedFolders.has(name)?'▸':'▾'}</span><span class="folder-icon">▰</span>${esc(name)}</div><div class="browser-items ${closedFolders.has(name)&&!query?'hidden':''}">${matches.map(([title,type])=>`<button class="browser-item" data-library="${esc(type)}" title="${esc(title)}"${type.startsWith('pattern:')?' draggable="true"':''}><span class="file-icon">${['kick','clap','hat','snare','openhat'].includes(type)?'≋':type==='cloud'?'☁':'♬'}</span>${esc(title)}${['bass','keys','pad','piano'].includes(type)?'<small>SYNTH</small>':''}</button>`).join('')}</div>`;}).join('');
 $$('.browser-folder').forEach(el=>el.onclick=()=>{const n=el.dataset.folder;closedFolders.has(n)?closedFolders.delete(n):closedFolders.add(n);renderBrowser();});
 if(browserTab==='patterns'){const b=document.createElement('button');b.className='browser-item';b.textContent='☁ Browse cloud pattern library';b.onclick=()=>{browserTab='pattern-library';renderBrowser();};$('#browser-tree').append(b);}
 $$('[data-library^="pattern:"]').forEach(el=>{el.ondragstart=e=>{e.dataTransfer.setData('application/vegetable-pattern',el.dataset.library.slice(8));e.dataTransfer.effectAllowed='copy';};});
 $$('[data-library]').forEach(el=>{el.onclick=()=>{const type=el.dataset.library;$('#browser-preview').textContent=el.textContent.trim();if(type==='cloud'){openCloudPanel().catch(fail);return;}if(type==='publish'){publishDialog();return;}if(type==='import'){importedTarget=null;$('#import-audio').click();return;}if(type==='record'){toggleRecord().catch(fail);return;}if(type==='patterns'){browserTab='patterns';renderBrowser();return;}if(type.startsWith('pattern:')){selectPattern(type.slice(8));return;}if(type==='history'){showHistory();return;}if(type==='info'){projectInfo();return;}const role={kick:'kick',clap:'clap',hat:'hat',snare:'snare',openhat:'open hat'}[type]||type,existing=project.channels.find(c=>c.type===type||c.name.toLowerCase().includes(role));if(existing)engine.preview(existing,['bass','pad'].includes(type)?36:60).catch(fail);else toast('Double-click to add this sound in Freestyle.');};el.ondblclick=()=>{const type=el.dataset.library;if(['bass','keys','pad','piano','kick','clap','hat','snare','openhat'].includes(type))addChannel(type,el.textContent.replace('SYNTH','').slice(1).trim());};});
}
function renderBrowser(){const views={all:'project-samples',plugins:'plugins',favorites:'sounds','pattern-library':'patterns',audio:'audio'},view=views[browserTab];if(!view){if(cloudLibrary){cloudLibrary.destroy();cloudLibrary=null;cloudLibraryView=null;}renderLegacyBrowser();return;}
 if(!engine.ready){if(cloudLibrary)return;$('#browser-tree').innerHTML='<div class="browser-folder">▾　Current project</div><button class="browser-item" id="browser-connect-cloud">☁ Connect Freestyle library</button>';$('#browser-connect-cloud').onclick=()=>openCloudPanel().catch(fail);return;}
 if(!cloudLibrary){$('#browser-tree').replaceChildren();cloudLibrary=new CloudLibraryBrowser({catalogPreview:!!STUDIO_API_OPERATIONS.previewCatalogSound,getRegistrationScope:fileImportScope,getFeatureProject:()=>project,container:$('#browser-tree'),searchInput:$('#browser-search'),previewContainer:$('#browser-preview-dock'),monitor:engine.monitor,getProject:async()=>{assertRangeIdle();if(!engine.ready)throw new Error('Select a Freestyle cloud project first.');if(engine.interacting)throw new Error('Finish the current drag before adding library content.');await engine.flush();return project;},call:async(name,args)=>{if(['materialize_sound_pack_item','apply_marketplace_pattern'].includes(name)){assertRangeIdle();if(engine.interacting)throw new Error('Finish the current drag before adding library content.');await engine.flush();}return engine.session.call(name,args);},prepareMedia:prepareLibraryMedia,inspectMediaError:url=>inspectLibraryPreviewError(url),onWriteState:busy=>document.body.classList.toggle('cloud-library-writing',busy),onError:fail,onStatus:toast,onSampleMaterialized:addMaterializedSample,onPatternApply:async({projectId})=>{if(projectId!==engine.projectId)throw new Error('The pattern was applied to the previous cloud project. Return to that project to edit it.');const previous=new Set(project.patterns.map(p=>p.id));await engine.refresh();const added=project.patterns.filter(p=>!previous.has(p.id));if(added.length===1)selectPattern(added[0].id);},onAuditionSample:({audioFileId})=>engine.previewSampleFile(audioFileId),onPreview:async item=>{$('#browser-preview').textContent=item.name||'Cloud sound';$('#browser-wave').innerHTML='<text x="0" y="27" fill="currentColor" font-size="9">CLOUD AUDIO PREVIEW</text>';const id=item.audioFileId||item.audio_file_id,existing=id&&project.channels.find(c=>c.audioFileId===id);if(existing){await engine.preview(existing);return true;}return false;}}).mount();}
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
function bindPlaylistDropRow(placed,row,{source,file=null}={}){
 if(!placed?.createdLane||!placed.laneId||!Number.isInteger(row)||row<0)return null;
 const occupant=project.cloud?.timelineLaneIds?.[row]||null;setLaneRowHint(engine.projectId,placed.laneId,row,{insert:!!occupant});
 return{source,...(file==null?{}:{file}),intendedRow:row,laneId:placed.laneId,occupantLaneId:occupant,insert:!!occupant,hintStored:laneRowHints(engine.projectId).get(placed.laneId)??null};
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
const timelineViewport=new TimelineViewport({element:$('#arrangement-scroll'),getScale:()=>barWidth,setScale:value=>{barWidth=value;document.documentElement.style.setProperty('--bar',`${value}px`);},gutter:PLAYLIST_GUTTER,min:4,/* up to ~6 source frames per pixel at 120 BPM: single waveform cycles are visible in the Tracks area */max:16384,canZoom:()=>!engine.interacting,onZoom:()=>{lastTickKey='';renderTimelineGeometry();updateTick(engine.positionAt());}});
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
const playlistKeyboard=new PlaylistKeyboardGesture({getProject:()=>project,getSelectedIds:()=>playlistSelection.ids,/* Logic: ⌥← / ⌥→ nudge the selected regions by the nudge value (⌃⌥T / D / B / M set it; Division = 1/16 by default) */getSnap:()=>logicNudgeBeats(),getMaxTrack:()=>$$('.track-lane').length-1,getScope:()=>({load:engine.loadVersion,context:engine.session.contextVersion}),getContext:()=>({pianoActive:activeEditor()==='piano',dialogOpen:shortcutDialogOpen(),playlistActive:activeEditor()==='playlist',modifier:'alt',horizontalOnly:true}),canStart:()=>!engine.interacting&&!windows.dragging&&playlistEditable(),canContinue:()=>!rangeBusy()&&!sliceBusy()&&!engine.loading&&!engine.editBlocked&&!windows.dragging,onStart:({selectedIds})=>{keyboardClipNodes=new Map($$('#playlist .clip[data-clip]').filter(node=>selectedIds.has(node.dataset.clip)).map(node=>[node.dataset.clip,node]));keyboardClipTransforms=new Map([...keyboardClipNodes].map(([id,node])=>[id,node.style.transform]));engine.interacting=true;activePlaylistCancel=()=>playlistKeyboard.cancel();},paint:({initial,clips,selectedIds})=>{const before=new Map(initial.map(clip=>[String(clip.id),clip]));for(const clip of clips){const id=String(clip.id),node=keyboardClipNodes.get(id),original=before.get(id);if(!node||!selectedIds.has(id))continue;const rowHeight=node.closest('.track-lane')?.getBoundingClientRect().height||playlistLaneHeight;node.style.transform=`translate3d(${(clip.start-original.start)*barWidth/4}px,${(clip.track-original.track)*rowHeight}px,0)`;}},restore:()=>{for(const [id,node]of keyboardClipNodes)node.style.transform=keyboardClipTransforms.get(id);keyboardClipNodes.clear();keyboardClipTransforms.clear();},onFinish:()=>{activePlaylistCancel=null;engine.interacting=false;},commit:({clips,selectedIds})=>{for(const clip of clips){if(!selectedIds.has(String(clip.id)))continue;const original=findClip(clip.id);if(original)Object.assign(original,{start:clip.start,track:clip.track});}changed();},onBlocked:toast,onError:fail});
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
$('#arrangement-scroll').addEventListener('scroll',()=>{paintClipWaves();},{passive:true});
/* Double-click on a region: the first click re-renders the Tracks area (selection), so the browser's dblclick can miss the
 * replaced element. Detect it on the stable scroller: two releases on the same region within 450 ms. */
{let last={id:null,at:0,x:0,y:0};window.addEventListener('pointerup',event=>{if(event.button!==0)return;const element=(document.elementFromPoint?.(event.clientX,event.clientY)||event.target)?.closest?.('#playlist .clip[data-clip]'),id=element?.dataset.clip||null,now=performance.now();if(id&&id===last.id&&now-last.at<450&&Math.hypot(event.clientX-last.x,event.clientY-last.y)<6&&tool==='select'){last={id:null,at:0,x:0,y:0};const current=$$('#playlist .clip[data-clip]').find(node=>node.dataset.clip===id);setTimeout(()=>{try{(current?.isConnected?current:$$('#playlist .clip[data-clip]').find(node=>node.dataset.clip===id))?.ondblclick?.();}catch(error){fail(error);}},0);return;}last={id,at:now,x:event.clientX,y:event.clientY};},true);}window.addEventListener('resize',()=>queueWavePaint());
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
  if(m.classList.contains('logic-tool-menu')&&(matchKeyCommand(e,'X')||['Shift','Meta','Control','Alt'].includes(e.key)))return;
  swallow();
  menuKeyDown(m,e,{close:()=>{m.classList.add('hidden');pianoSnapMenuCancel?.();},adjacent:dir=>{if(!mainMenuOpen||m.firstElementChild!==mainMenuOpen.node)return;const names=MAIN_MENU_ORDER;openMainMenu(names[(names.indexOf(mainMenuOpen.name)+dir+names.length)%names.length]);}});
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
 assign:'Assign to new instrument track needs Freestyle’s per-channel Channel Rack routes on a sample channel.',
 waveformEmpty:'This sample channel has no sample loaded in Freestyle; load one to show its waveform.',
 receive:'Freestyle has no per-channel MIDI input assignment; MIDI input plays the selected channel.',
 receiveSample:'Receive notes from sets an instrument channel’s Freestyle MIDI channel; a sample channel has none.',
 route:'Mixer track routing (outputLaneId) applies to sample channels with Freestyle’s per-channel Channel Rack routes.'};
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
 // Freestyle features with no counterpart in the reference's Step Sequencer row menu (appended after its entries).
 const extras=[{label:'Open in Piano Roll',shortcut:'',checked:channel().id===id,/* ✓ = this row is the Piano Roll's target (window open or not) */run:()=>{selectedChannel=id;showWindow('piano');}},{label:'Edit Step Velocity',checked:!!rackGraph?.visible&&channel().id===id,run:()=>{selectedChannel=id;toggleRackGraph();}},null,
  ops?{label:'Change color…',run:()=>channelColorDialog(c)}:off('Change color…','color'),ops?{label:'Random color',run:()=>updateRackChannel(c,{color:randomChannelColor(c.cloudSource?.color)},'Random color')}:off('Random color','color'),ops?{label:'Change icon…',run:()=>channelIconDialog(c)}:off('Change icon…','icon'),null,
  {label:'Load sample…',run:()=>{importedTarget=id;$('#import-audio').click();}},ops&&sample?{label:'Cut itself',checked:cutsItself,title:sharedCut?`Cut group ${group} (shared): a new note stops this channel’s own and the group’s sounding notes. Click to clear the group.`:cutsItself?`A new note stops this channel’s sounding note (cut group ${group}). Click to turn it off.`:'',run:()=>updateRackChannel(c,{cutGroup:cutsItself?null:freeCutGroup(sources,c.sourceId)},'Cut itself')}:off('Cut itself','cutSelf'),ops&&sample?{label:'Cut group',submenu:cutGroupItems(c)}:off('Cut group','cutSelf',{submenu:[]}),sample&&c.audioFileId?{label:'Show waveform preview',checked:rackWaveformChannels.has(id),run:()=>toggleRackWaveform(c)}:off('Show waveform preview',sample?'waveformEmpty':'waveform'),null,
  insert,replace,null,ops&&sample?{label:'Assign to new instrument track',run:()=>rackChannelEdit(c,ops=>ops.assignToNewTrack(c.patternId,c.sourceId,{name:c.name}))}:off('Assign to new instrument track',ops?'assignPlugin':'assign'),ops&&sample?{label:'Route to mixer track',submenu:routeItems(c)}:off('Route to mixer track','route',{submenu:[]}),{label:'Create automation clip',submenu:channelAutomationItems(c)},
  null,
  {label:'Cut',run:()=>rackClipboardAction('cut'),title:'Copy the selected rows’ steps, then clear them.'},
  stepItem('Fill each 2 steps',()=>fillRackChannel(id,2)),stepItem('Fill each 4 steps',()=>fillRackChannel(id,4)),stepItem('Fill each 8 steps',()=>fillRackChannel(id,8)),stepItem('Advanced fill…',()=>advancedFillDialog(id)),null,
  // 338 PatternChannel.midiChannel is the one saved MIDI field: "Receive notes
  // from ▸" picks it (the instrument receives this channel's notes on that MIDI channel).
  ops&&!sample?{label:'Receive notes from',title:'The MIDI channel this instrument receives the channel’s notes on (notes without their own channel). Saved as the channel’s midiChannel.',submenu:midiChannelItems(c)}:off('Receive notes from',sample?'receiveSample':'midiChannel',{submenu:[]})];
 // Logic's Step Sequencer row menu (logic-context-menu.js stepRowMenuItems): the reference's entries in its order, then ours in a second column.
 menu(e,stepRowMenuItems({divider:MENU_COLUMN,extras,state:{steps:!!steps,canPaste:!!rackClipboard,duplicateReason:cloneOff,deleteReason:project.channels.length===1?'A Freestyle project keeps at least one row.':null},
  run:{copy:()=>rackClipboardAction('copy'),paste:()=>rackClipboardAction('paste'),duplicate:()=>cloneRackChannel(id),delete:()=>deleteChannelConfirm(c),clear:()=>rackClipboardAction('delete'),rename:()=>channelAppearanceDialog(c),'rotate-left':()=>rotateRackChannels(rackStepChannelIds(id),-1),'rotate-right':()=>rotateRackChannels(rackStepChannelIds(id),1)}}));}
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
function paintTransportBusy(){const reading=currentPlayClockRead(),busy=modeSwitchPending||!!stopRequest,starting=!!(reading||engine.playAttempt)&&!busy,button=$('#play');button.disabled=busy;button.classList.toggle('starting',starting);if(starting)button.classList.remove('playing');button.setAttribute('aria-busy',String(busy||starting));button.title=reading&&!busy?'Reading playback state · click Play again to cancel':starting?'Starting playback · click to cancel':busy?'Updating playback…':!engine.previewing&&transportClockUnknown()?unknownPlaybackTitle:playButtonTitle;button.setAttribute('aria-label',button.title);$('#mode').disabled=modeSwitchPending;$('#mode').setAttribute('aria-busy',String(modeSwitchPending));paintRecordingButton();}
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
async function togglePlay({stopInsteadOfPause=false,fromRecord=false,startBeat=null}={}){
 // Logic: Space during a take stops it (Stop ends the take and finalizes it).
 if(!fromRecord&&engine.recordingContext?.state==='recording'&&engine.recorder.recording)return stop();
 if(!fromRecord&&midiTake)return finishMidiRecording();
 if(modeSwitchPending||stopRequest){toast('Wait for playback to stop before pressing Play.');return false;}
 if(currentPlayClockRead()){const cancelled=playClockRead;playClockRead=null;++transportUiVersion;if(cancelled.scope===playbackUiScope()&&$('#status-message').textContent===cancelled.message)$('#status-message').textContent='Playback request cancelled.';if($('#hint').textContent===cancelled.message)$('#hint').textContent='Playback request cancelled.';paintTransportBusy();return false;}
 if(engine.playAttempt)return stop();
 const version=++transportUiVersion,scope=playbackUiScope(),selectedMode=mode,current=()=>version===transportUiVersion&&scope===playbackUiScope()&&!engine.loading&&!modeSwitchPending&&!stopRequest;
 let reading=null;try{let playing=engine.playing;if(!engine.previewing&&transportClockUnknown()){reading={scope,version,message:'Reading playback state in Freestyle…',error:null};playClockRead=reading;$('#status-message').textContent=reading.message;$('#hint').textContent=reading.message;paintTransportBusy();let clock;try{clock=await engine.ensureTransportKnown();}catch(error){if(playClockRead!==reading||!current())return false;if($('#hint').textContent===reading.message)$('#hint').textContent=error.message||String(error);throw error;}if(playClockRead===reading)playClockRead=null;paintTransportBusy();if(!current())return false;playing=clock.playing;}if(playing){if(stopInsteadOfPause)return stop();await engine.pause();if(!current())return false;setPlaylistCursor(engine.positionAt().beat);$('#play').classList.remove('playing');$('#play').textContent='▶';$('#status-message').textContent='Paused';}
 else{rangePlayback=null;const playing=engine.play(project,selectedMode,selectedMode==='song'?{startSeconds:(Number.isFinite(startBeat)&&startBeat>=0?startBeat:editCursorBeat)*60/project.bpm}:undefined);paintTransportBusy();if(engine.playAttempt)$('#status-message').textContent='Starting playback · click Play again to cancel';const result=await playing;if(result===false||!current())return false;$('#play').classList.add('playing');$('#play').textContent='Ⅱ';$('#status-message').textContent=`Playing ${selectedMode==='pattern'?pattern().name:'arrangement'} · ${project.bpm} BPM`;if(selectedMode==='song')rememberSongPlayingStatus($('#status-message').textContent,scope,version);startTransportFrames();}return true;}finally{if(playClockRead===reading)playClockRead=null;if(reading&&scope===playbackUiScope()&&$('#hint').textContent===reading.message)$('#hint').textContent=$('#status-message').textContent;paintTransportBusy();}
}
async function finishRecordingForStop(){
 const context=engine.recordingContext;if(context?.stopPromise){try{await context.stopPromise;}finally{paintRecordingButton();}return;}
 if(context?.state==='starting'||engine.recorder.state==='connecting'){try{await engine.cancelRecording();}finally{paintRecordingButton();}return;}
 if(context||engine.recorder.recording){const capture=toggleRecord({transportStop:true}),saving=context?.stopPromise;await capture;if(saving)await saving;if(engine.recorder.recording||engine.recordingContext)throw new Error('Finish saving the microphone take before changing playback mode.');}
}
/** Stop with a take open: take_stop goes out FIRST (finishRecordingForStop sends it synchronously),
 * then transport Stop. Freestyle refuses Stop with recording_shared while the take/arm is still
 * open; then finish the take (finalize ends the arm) and retry, so Stop never leaves it rolling. */
const RECORDING_STOP_RETRY_MS=90000,RECORDING_STOP_RETRY_GAP_MS=750;
function recordingActive(){return !!(engine.recordingContext||engine.recorder?.recording||['connecting','stopping'].includes(engine.recorder?.state));}
async function stopTransportAndTake({wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 if(!recordingActive())return engine.stop();
 const saving=finishRecordingForStop();let settled=false;const done=saving.then(()=>{settled=true;},()=>{settled=true;});
 const deadline=Date.now()+RECORDING_STOP_RETRY_MS;
 // Logic: Stop is immediate. While Freestyle still refuses the transport stop (the take is closing), the displayed
 // playhead stays frozen where Stop was pressed and the receive audio stays silenced; the retries only confirm it.
 let frozen=null;const freeze=()=>{try{frozen=engine.holdLocalStop?.('stop')??null;engine.monitor.silence?.();updateTick(engine.positionAt());}catch{}};
 for(let attempt=1;;attempt++){
  try{await engine.stop();if(attempt>1)clientLog('recording-stop-retried',{attempt});break;}
  catch(error){
   if(error?.code!=='recording_shared'||Date.now()>deadline){try{engine.releaseLocalStop?.(frozen);}catch{}throw error;}
   freeze();
   clientLog('recording-stop-refused',{attempt,code:error.code,takeSaving:!settled});
   if(!settled)await Promise.race([done,wait(RECORDING_STOP_RETRY_GAP_MS*4)]);else await wait(RECORDING_STOP_RETRY_GAP_MS);
  }
 }
 await saving;
}
function stop(){
 if(midiTake){finishMidiRecording({stopTransport:false}).catch(fail);}
 pianoScrubCancel?.();playClockRead=null;++transportUiVersion;if(stopRequest)return stopRequest;const scope=playbackUiScope();$('#status-message').textContent=engine.previewing||engine.playAttempt?.previewPending?'Stopping pattern preview in Freestyle…':'Stopping playback in Freestyle…';
 const range=rangePlayback;const request=(async()=>{try{await stopTransportAndTake();if(scope!==playbackUiScope()||engine.loading)return false;if(range&&rangePlayback===range){rangePlayback=null;syncCursorFromEngine();}$('#play').classList.remove('playing');$('#play').textContent='▶';if(playheadFrame!==null)cancelAnimationFrame(playheadFrame);playheadFrame=null;updateTick(engine.positionAt?.()||{beat:engine.beat,playing:false,mode});$('#status-message').textContent='Stopped';return true;}catch(error){if(scope===playbackUiScope()&&!engine.loading)fail(error);return false;}})();
 // Studio Pro: Stop takes effect locally on this frame (engine.stop has already
 // faded the receive audio and frozen the clock); the engine ACK only confirms it.
 if(playheadFrame!==null)cancelAnimationFrame(playheadFrame);playheadFrame=null;try{if(engine.localStopHold)updateTick(engine.positionAt());}catch{}
 const pending=request.finally(()=>{if(stopRequest===pending){stopRequest=null;paintTransportBusy();}});stopRequest=pending;paintTransportBusy();return pending;
}
/** Logic ⇧Space “Play from Selection”: the selected regions’ span once, through the published
 * REST playRange (no native range message exists). Stop stays the normal fast stop path. */
/** The Play from Selection run in progress (null otherwise). When it ends, by the engine
 * reaching end_sec or by Stop, the edit cursor / LCD adopt the engine's actual stop position
 * (never the range start), so Space and "at the playhead" agree with the engine. */
let rangePlayback=null;
function syncCursorFromEngine(){let t;try{t=engine.positionAt?.();}catch{return false;}if(!t||t.playing||t.localStop||transportClockUnknown(t)||!Number.isFinite(Number(t.beat)))return false;setPlaylistCursor(Math.max(0,Number(t.beat)));return true;}
function finishRangePlayback(run=rangePlayback){if(!run||rangePlayback!==run||run.scope!==playbackUiScope())return false;if(!syncCursorFromEngine())return false;rangePlayback=null;if($('#status-message').textContent.startsWith('Playing the selection'))$('#status-message').textContent='Stopped at the end of the selection';return true;}
async function playFromSelection(){
 if(modeSwitchPending||stopRequest){toast('Wait for playback to stop before pressing Play.');return false;}
 if(recordingActive()){toast('Stop recording before Play from Selection.');return false;}
 const regions=allClips().filter(clip=>playlistSelection.ids.has(clip.id)),range=selectionRange({regions,marquee:null,bpm:project.bpm});
 if(!range){toast('Select regions to play them (Play from Selection, ⇧Space).');return false;}
 const client=restMixer?.isRestMode===true?restMixer.client:null;
 if(!client){toast('Play from Selection needs a Studio API (OAuth) project. Reload the project.');return false;}
 if(!engine.ready||engine.loading){toast('Wait for the project to finish loading.');return false;}
 const run={scope:playbackUiScope(),range};let dispatch;try{dispatch=playRangeDispatch({client,session:engine.session,projectId:engine.projectId,trackId:engine.session.trackId,range,log:clientLog,onEnded:()=>finishRangePlayback(run)});}catch(error){fail(error);return false;}
 const version=++transportUiVersion,scope=playbackUiScope(),current=()=>version===transportUiVersion&&scope===playbackUiScope()&&!engine.loading&&!modeSwitchPending&&!stopRequest;
 try{
  // Song transport only: a running pattern preview stops first (as Play from the Tracks area does).
  if(mode!=='song'||engine.previewing){if(await stop()===false||scope!==playbackUiScope())return false;}
  mode='song';$('#mode').classList.add('song');setPlaylistCursor(range.startBeat);
  const playing=engine.play(project,'song',{startSeconds:range.startSec,dispatch});paintTransportBusy();
  rangePlayback=null;const result=await playing;if(result===false||!current())return false;rangePlayback=run;
  $('#play').classList.add('playing');$('#play').textContent='Ⅱ';$('#status-message').textContent=`Playing the selection (${range.startSec.toFixed(2)}–${range.endSec.toFixed(2)} s)`;startTransportFrames();return true;
 }catch(error){fail(error);return false;}finally{paintTransportBusy();}
}
/** Logic “Send All Notes Off” (double-click Stop): engineMidiAllNotesOff for every instrument lane. Not an undo step. */
let midiPanicPending=null;
function midiPanic(){
 if(midiPanicPending)return midiPanicPending;
 const client=restMixer?.isRestMode===true?restMixer.client:null;
 if(!client){toast('Send All Notes Off needs a Studio API (OAuth) project. Reload the project.');return Promise.resolve(null);}
 if(!engine.ready){toast('Open a Freestyle project first.');return Promise.resolve(null);}
 try{engine.releaseNotes?.();}catch{}
 const instrumentIds=panicInstrumentIds(engine.session.rawProject||project.cloud?.rawProject);
 if(!instrumentIds.length){toast('Send All Notes Off: this project has no instrument tracks.');return Promise.resolve({sent:0,failed:[],instruments:0});}
 const pending=sendMidiPanic({client,projectId:engine.projectId,instrumentIds,trackId:engine.session.trackId,log:clientLog}).then(result=>{
  toast(result.failed.length?`All Notes Off sent to ${result.sent} of ${result.instruments} instruments; ${result.failed[0].message}`:`All Notes Off sent to ${result.sent} instrument${result.sent===1?'':'s'}.`);return result;
 },error=>{fail(error);return null;}).finally(()=>{if(midiPanicPending===pending)midiPanicPending=null;});
 midiPanicPending=pending;return pending;
}
let playheadFrame=null,lastTimeText='';
function updateTick(t){if(audioEditorView&&!$('#audio-editor').classList.contains('hidden'))try{audioEditorView.paint();}catch{}
 logicCatchPlayhead(t);
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
 if((positionUnknown||available||!t.playing)&&!dragging){/* Logic's LCD always shows the playhead: an unconfirmed transport shows the edit cursor (dimmed), never dashes. */const displayBeat=t.playing&&!positionUnknown?beat:editCursorBeat,text=formatTransportPosition(displayBeat),raw=$('#time-value');raw.dataset.beat=String(displayBeat);$('#time-display').classList.toggle('lcd-unconfirmed',positionUnknown);if(text!==lastTimeText){raw.textContent=text;lastTimeText=text;}}
 const step=phase.active?phase.step:-1;if(step!==lastTickStep&&!dragging){lastTickStep=step;$$('.step.current').forEach(b=>b.classList.remove('current'));if(step>=0)$$(`.step[data-step="${step}"]`).forEach(b=>b.classList.add('current'));}
 $('#edit-playhead').classList.toggle('is-ghost',rolling&&mode==='song');$('#edit-playhead').style.display='block';$('#edit-playhead').dataset.timelineX=String(editCursorBeat/4*barWidth);$('#edit-playhead').style.transform=`translate3d(${editCursorBeat/4*barWidth}px,0,0)`;
 $('#song-playhead').style.display=rolling&&mode==='song'?'block':'none';$('#song-playhead').dataset.timelineX=String(beat/4*barWidth);$('#song-playhead').style.transform=`translate3d(${beat/4*barWidth}px,0,0)`;syncPlaylistCursorViewport();
 $('#piano-playhead').style.display=phase.active?'block':'none';if(phase.active)$('#piano-playhead').style.transform=`translate3d(${phase.beat/4*pianoBarWidth}px,0,0)`;
}
function renderTransportFrame(at){playheadFrame=null;const tick=engine.positionAt?.(at)||{beat:engine.beat,playing:engine.playing};updateTick(tick);if(tick.playing&&tick.clockAvailable!==false)playheadFrame=requestAnimationFrame(renderTransportFrame);}
function startTransportFrames(){if(playheadFrame===null)playheadFrame=requestAnimationFrame(renderTransportFrame);}
// Default primes its sink/receiver on pointer intent over the transport and rack : the first Space/Play is instant.
document.addEventListener('pointerdown',event=>{if(event.target?.closest?.('#play,#mode,#stop,#rack'))engine.primeTransport?.('pointer-intent');},{passive:true,capture:true});
engine.onTick=t=>{if(t.playing)startTransportFrames();else{if(playheadFrame!==null)cancelAnimationFrame(playheadFrame);playheadFrame=null;if(rangePlayback&&!stopRequest&&!t.localStop&&finishRangePlayback())return;updateTick(t);}};engine.onEnded=stop;
async function toggleLoopPlayback(){const scope=playbackUiScope(),clock=await engine.ensureTransportKnown({loop:true});if(scope!==playbackUiScope()||engine.loading)throw Object.assign(new Error('The project changed before its loop could be toggled.'),{name:'AbortError'});if(transportClockUnknown(clock)||typeof clock.loopEnabled!=='boolean')throw new Error('Freestyle has not supplied the current loop state.');/* #17 (2026-11-18): the loop switch and the region are separate in Freestyle: {enabled:false} keeps the cycle area and
 {enabled:true} alone loops it again. Only a project that never had a cycle area answers 409 loop_region_required; Logic
 then shows its default cycle area (bars 1–5), which is sent explicitly. */return playlistLoop.apply({enabled:!clock.loopEnabled}).catch(error=>{if(clock.loopEnabled||!loopRegionRequired(error))throw error;clientLog('cycle-default-area',{code:'loop_region_required',requestId:error?.requestId??error?.cause?.requestId??null});return playlistLoop.apply({enabled:true,startBeat:0,endBeat:16});});}
/** 409 loop_region_required: Cycle was switched on with no cycle area (any error envelope). */
function loopRegionRequired(error){for(let value=error,depth=0;value&&depth<5;value=value.cause,depth++){if(value.code==='loop_region_required'||value.data?.error?.code==='loop_region_required'||value.metadata?.code==='loop_region_required')return true;}return /loop_region_required/.test(String(error?.message||''));}

function paintRecordingButton(){
 recording=!!engine.recorder.recording||!!midiTake;const button=$('#record'),starting=engine.recordingContext?.state==='starting'||engine.recorder.state==='connecting',saving=engine.recordingContext?.state==='stopping'||engine.recorder.state==='stopping';
 button.classList.toggle('recording',recording);button.disabled=saving||modeSwitchPending||!!stopRequest;button.setAttribute('aria-busy',String(starting||saving));button.title=saving?'Saving microphone take…':starting?'Cancel microphone connection':recording?'Stop and save microphone recording':'Record microphone';button.setAttribute('aria-label',button.title);
}
/* Audio Track Editor (Editors ▸ Audio Track Editor): the selected audio region (else the first audio region of the
 * selected track), painted from the same peak pyramid as the Tracks area, zoomable to single samples. */
let audioEditorView=null;
function audioEditorRegion(){
 if(!project)return null;const clips=project.audioClips||[],selected=clips.find(clip=>playlistSelection.has(clip.id)&&clip.cloudId),row=selectedTrackRow();
 const clip=selected||clips.filter(item=>item.cloudId&&item.track===row).sort((a,b)=>a.start-b.start)[0]||null;if(!clip)return null;
 const bpm=Number(project.bpm)||120,secondsPerBeat=60/bpm;
 return{clipId:clip.cloudId,name:clip.name||'Audio',offsetSec:(clip.offsetKnown===false?0:Number(clip.offset)||0)*secondsPerBeat,lengthSec:clip.length*secondsPerBeat,startBeat:clip.start,bpm,gain:Number.isFinite(Number(clip.volume))?Number(clip.volume):1};
}
function paintAudioEditor(){
 const body=$('#audio-editor-body'),pane=$('#audio-editor');if(!body||!pane||pane.classList.contains('hidden'))return;
 if(!audioEditorView){audioEditorView=mountAudioEditor(body,{pyramid:wavePyramid,getRegion:audioEditorRegion,getPlayheadBeat:()=>{const clock=engine.positionAt?.();return clock?.playing&&Number.isFinite(Number(clock.beat))?Number(clock.beat):editCursorBeat;},onSeekBeat:beat=>{try{playlistCursorJump(beat);}catch{}}});const zoom=$('#audio-editor-zoom');if(zoom)zoom.oninput=()=>audioEditorView.setZoom(Number(zoom.value)/1000);window.illogic=Object.assign(window.illogic||{},{audioEditor:audioEditorView});}
 const region=audioEditorRegion(),info=region?wavePyramid.info(region.clipId):null;
 const name=$('#audio-editor-name');if(name){const text=region?region.name:'No audio region selected';if(name.textContent!==text)name.textContent=text;}
 const detail=$('#audio-editor-info');if(detail){const text=region&&info?`${Math.round(info.sampleRate)} Hz · ${info.channelCount===1?'Mono':info.channelCount===2?'Stereo':info.channelCount+' ch'} · ${region.lengthSec.toFixed(3)} s`:'';if(detail.textContent!==text)detail.textContent=text;}
 audioEditorView.paint();const zoom=$('#audio-editor-zoom');if(zoom&&document.activeElement!==zoom)zoom.value=String(Math.round(audioEditorView.zoomAmount()*1000));
}
/* Logic recording region: red, on the record target track from the punch-in point, growing with the playhead
 * and the live microphone level; it stays ("saving…") after Stop until the saved clip replaces it. */
const recordingRegion=new RecordingRegionView({host:row=>Number.isInteger(row)&&row>=0?$(`#playlist .lane-grid[data-track="${row}"]`):null,pixelsPerBeat:()=>barWidth/4});let recordingRegionTimer=null;
function recordingRegionRow(laneId){const rows=project?.cloud?.timelineLaneIds||[],row=laneId?rows.indexOf(laneId):-1;if(row>=0)return row;const selected=selectedTrackRow();return selected===null?0:selected;}
function beginRecordingRegion({laneId,startSec}){
 const bpm=Number(project?.bpm)||120;recordingRegion.begin({row:recordingRegionRow(laneId),startSec:Number.isFinite(startSec)&&startSec>=0?startSec:0,bpm});
 clearInterval(recordingRegionTimer);let busy=false;
 recordingRegionTimer=setInterval(async()=>{
  if(!recordingRegion.active){clearInterval(recordingRegionTimer);recordingRegionTimer=null;return;}
  const context=engine.recordingContext,take=recordingRegion.take;
  if(context?.laneId&&take){const row=recordingRegionRow(context.laneId);if(row!==take.row)take.row=row;}
  if(recordingRegion.state!=='recording'||busy){recordingRegion.paint();return;}
  // The take's own start (count-in) is adopted once the engine reports it; the region grows only while the take records.
  if(context&&Number.isFinite(context.songStartSec)&&context.state==='recording'&&take&&Math.abs(context.songStartSec-take.startSec)>1e-6&&recordingRegion.levels.values.length===0){take.startSec=context.songStartSec;take.nowSec=Math.max(take.nowSec,take.startSec);}
  busy=true;try{
   const capturing=engine.recorder.recording&&context?.state==='recording',position=capturing?engine.positionAt?.():null,now=performance.now();
   // Only a rolling transport that continues from the take's last position grows the region (a stopped
   // transport still reports where the previous playback ended).
   let seconds=NaN;if(position?.playing===true&&Number.isFinite(Number(position.seconds))){const value=Number(position.seconds),allowed=take.nowSec+(now-(take.acceptedAt??now))/1000+.75;if(value>=take.startSec-1e-3&&value<=allowed){seconds=value;take.acceptedAt=now;}else if(take.acceptedAt===undefined)take.acceptedAt=now;}
   const level=capturing&&Number.isFinite(seconds)?await engine.recorder.inputLevel():null;recordingRegion.update({nowSec:seconds,level});
  }catch{}finally{busy=false;}
 },1000/20);recordingRegionTimer?.unref?.();
}
function endRecordingRegion(){clearInterval(recordingRegionTimer);recordingRegionTimer=null;recordingRegion.end();}
/* Record-enable (R on a track header) opens that track's microphone uplink at once, so Record starts the take without
 * connecting first; disarming closes it. Re-armed after every take. */
function syncRecordingPrewarm(){try{const laneId=logicRegionTools?.recordTarget?.()?.laneId;if(laneId)engine.prewarmRecording(laneId);else engine.dropRecordingPrewarm();}catch{}}
document.addEventListener('click',event=>{if(event.target?.closest?.('.logic-track-r'))setTimeout(syncRecordingPrewarm,50);},true);
/* Recording (Studio API take): target track, count-in LCD, undo step, engine-rolled transport. */
const countInDisplay=countInLcd(document);let recordingHistory=null;
function recordingTarget(){
 const armed=logicRegionTools?.recordTarget?.()||{};if(armed.laneId)return armed;
 const row=selectedTrackRow(),laneId=row===null?null:project.cloud?.timelineLaneIds?.[row],lane=(project.cloud?.rawProject?.lanes||[]).find(item=>item.id===laneId);
 return lane&&['audio','vocal'].includes(lane.kind)?{laneId}:{};
}
function recordingTakeHistory(){
 try{const scope=fileImportScope(),assert=()=>{if(JSON.stringify(scope)!==JSON.stringify(fileImportScope())||!engine.ready||engine.loading)throw Object.assign(new Error('The project changed during recording.'),{name:'AbortError'});};
  const read=async()=>{assert();const result=await engine.session.call('get_project',{project_id:scope.projectId});assert();const saved=projectPlaylistCloneRead(engine,result,scope);engine.session.rawProject=saved.rawProject;engine.session.rawState=saved.rawState;engine.session.project=saved.project;engine.accept(saved.project);};
  return new RecordingTakeHistory({history:()=>engine.patternHistory,getProject:()=>project,log:clientLog,createController:async()=>{await read();assert();return new AudioImportHistoryController({before:project,getProject:()=>project,getSaved:()=>engine.session.project,getScope:fileImportScope,read,call:(...args)=>engine.session.call(...args),flush:()=>engine.flush(),onChange:()=>mixerView?.render()});}});
 }catch{return null;}
}
/** startRecording start_transport rolled the engine on the count-in boundary: show it playing. */
function adoptRecordingTransport(){
 const adopt=()=>{if(!engine.positionAt?.()?.playing)return false;$('#play').classList.add('playing');$('#play').textContent='Ⅱ';$('#status-message').textContent='Recording';startTransportFrames();return true;};
 if(!adopt())for(const ms of [150,400,900,1800])setTimeout(()=>{if(engine.recorder.recording&&!$('#play').classList.contains('playing'))adopt();},ms);
}
/** The selected software-instrument track, when no audio track is record-enabled (Logic records MIDI there). */
function midiRecordTarget(){
 if(logicRegionTools?.recordTarget?.()?.laneId)return null;
 const row=selectedTrackRow(),laneId=row===null?null:project.cloud?.timelineLaneIds?.[row];if(!laneId)return null;
 const lane=project.channels.find(item=>!item.patternSource&&item.laneId===laneId&&(item.type==='instrument'||item.instrumentType));
 return lane?{row,laneId,channel:lane}:null;
}
async function startMidiRecording(target){
 const bpm=Number(project.bpm)||120,rolling=takeBeat(),startBeat=rolling??editCursorBeat,take={...target,startBeat,bpm,take:new NoteTake({startBeat}),name:project.trackNames?.[target.row]||target.channel.name||'MIDI Region'};
 midiTake=take;paintRecordingButton();
 recordingRegion.begin({row:target.row,startSec:startBeat*60/bpm,bpm,name:take.name,painter:(context,{width,height,seconds})=>paintTakeNotes(context,take.take.preview(takeBeat()??startBeat+seconds*bpm/60),{width,height,startBeat,lengthBeats:Math.max(1/16,seconds*bpm/60)})});
 // Count-in (Record ▸ Count-in, ⇧K) from stop: a pre-roll of that many beats before the take start (logic-note-recorder.js midiCountInPlan).
 let plan={mode:'none',beats:0,playFromBeat:startBeat};try{plan=midiCountInPlan({startBeat,countInBeats:logicRegionTools?.countIn?.beats?.($('#lcd-signature')?.textContent)??0,rolling:rolling!==null});}catch(error){clientLog('midi-recording',{phase:'count-in-error',message:String(error?.message||error).slice(0,160)});}
 take.countIn=plan;let counting=plan.mode!=='none';const endCount=()=>{if(!counting)return;counting=false;countInDisplay.end();};
 clearInterval(recordingRegionTimer);recordingRegionTimer=setInterval(()=>{if(midiTake!==take||!recordingRegion.active){clearInterval(recordingRegionTimer);recordingRegionTimer=null;endCount();return;}const beat=takeBeat();if(counting&&beat!==null&&beat>=startBeat)endCount();recordingRegion.update({nowSec:beat===null?NaN:Math.max(startBeat,beat)*60/bpm,level:null});},1000/20);recordingRegionTimer?.unref?.();
 clientLog('midi-recording',{phase:'start',laneId:target.laneId,startBeat,countIn:plan.mode,countInBeats:plan.beats});
 // #21 (2026-11-18): from a stopped transport the count-in is Freestyle's own: play with count_in_beats clicks the beats
 // (also with the metronome off, also before bar 1) and starts the transport one beat after the last click.
 if(plan.mode!=='none'&&rolling===null&&STUDIO_API_OPERATIONS.play&&engine.session.rawState?.studioApi===true){
  const beats=Math.max(1,Math.min(16,plan.beats));toast(`Count-in: ${beats} beat${beats===1?'':'s'}, then recording MIDI on ${take.name}.`);countInDisplay.handle({phase:'start',beats,bpm});
  const started=performance.now();let response;
  try{response=await countInPlay({beats,seekSeconds:startBeat*60/bpm,bpm});}
  catch(error){endCount();const code=countInErrorCode(error);clientLog('midi-recording',{phase:'count-in-refused',code,status:error?.status??null,requestId:error?.requestId??null,ms:Math.round(performance.now()-started)});
   if(midiTake!==take)return;midiTake=null;endRecordingRegion();paintRecordingButton();
   if(code==='count_in_cancelled'){toast('Count-in cancelled: nothing was recorded.');return;}
   throw Object.assign(new Error(code==='transport_rolling'?'Freestyle is already playing: stop playback, then record again.':code==='recording_in_progress'?'An audio take is being recorded in this project; its own count-in applies. Record MIDI when it ends.':error.message),{cause:error});}
  endCount();clientLog('midi-recording',{phase:'count-in-played',beats,ms:Math.round(performance.now()-started),transportStarted:response?.transport_started??null,startPositionSec:response?.start_position_seconds??null,countInBpm:response?.count_in_bpm??null});
  if(midiTake!==take){engine.stop().catch(()=>{});return;}
  // The engine rolls from the take start: show it playing (the take stamps notes against the engine clock).
  adoptCountInTransport();return;
 }
 const metronomeOn=metronomeState?.().actual===true;
 toast(plan.mode==='none'?`Recording MIDI on ${take.name}. Play the keyboard (⌘K: Musical Typing).`:`Count-in: ${plan.beats} beat${plan.beats===1?'':'s'}, then recording MIDI on ${take.name}.${plan.mode==='preroll'&&!metronomeOn?' Turn the metronome on (K) to hear the click.':plan.mode==='wait'?' The LCD counts the beats (there is no bar before the project start for the click to play in).':''}`);
 if(plan.mode!=='none')countInDisplay.handle({phase:'start',beats:plan.beats,bpm});
 if(plan.mode==='wait'){await new Promise(resolve=>setTimeout(resolve,plan.beats*60000/bpm));endCount();if(midiTake!==take)return;}
 if(rolling===null)await togglePlay({fromRecord:true,startBeat:plan.playFromBeat});
}
/** #21: POST /transport/play {count_in_beats, seek_seconds, bpm, wait:true}: answers on the downbeat (transport_started). */
async function countInPlay({beats,seekSeconds,bpm}){
 const body={count_in_beats:beats,seek_seconds:Math.max(0,Math.round(seekSeconds*1e6)/1e6),wait:true,...Number.isFinite(bpm)&&bpm>=20&&bpm<=400?{bpm}:{}};
 const result=await new StudioApiClient().call('play',{path:{project_id:engine.projectId},body});const data=result?.data??result;return data?.response??data;
}
function countInErrorCode(error){return error?.code&&error.code!=='studio_http_error'?error.code:error?.data?.error?.code??null;}
function adoptCountInTransport(){const adopt=()=>{if(!engine.positionAt?.()?.playing)return false;$('#play').classList.add('playing');$('#play').textContent='Ⅱ';$('#status-message').textContent='Recording';startTransportFrames();return true;};if(!adopt())for(const ms of [100,300,700,1500])setTimeout(()=>{if(midiTake&&!$('#play').classList.contains('playing'))adopt();},ms);}
/** End the take: one new MIDI region on the track holding the played notes (create region + notes; ⌘Z removes them). */
async function finishMidiRecording({stopTransport=true}={}){
 const take=midiTake;if(!take)return false;midiTake=null;paintRecordingButton();
 const endBeat=takeBeat()??Math.max(take.startBeat,Number(engine.positionAt?.()?.beat)||take.startBeat),played=take.take.finish(endBeat);recordingRegion.saving();
 try{musicalTypingAudition.releaseAll?.();}catch{}
 if(stopTransport)try{await engine.stop();$('#play').classList.remove('playing');$('#play').textContent='▶';}catch(error){clientLog('midi-recording',{phase:'stop-error',message:String(error?.message||error).slice(0,160)});}
 try{
  if(!played.length){toast('Nothing was played: no MIDI region was created.');return false;}
  for(let wait=0;wait<80&&(workspaceBusy()||engine.interacting||engine.applying);wait++)await new Promise(resolve=>setTimeout(resolve,50));
  const made=await createPatternRegionAt(take.row,take.startBeat,'midi');if(!made)throw new Error('The MIDI region for this take could not be created. The played notes were not saved.');
  const clip=project.clips.find(item=>item.id===made.clipId),regionStart=clip?clip.start:take.startBeat,notes=takeToRegionNotes(played,{regionStart,uid});
  selectPattern(made.patternId);const p=project.patterns.find(item=>item.id===made.patternId),current=channel(),target=current&&(current.type==='instrument'||current.instrumentType)&&(current.laneId===take.laneId||current.patternSource)?current:take.channel;
  if(!p||!target)throw new Error('The new MIDI region is not editable yet. Reload the project and record again.');
  const length=takeLengthBeats(notes);
  if(!edit(()=>{p.notes[target.id]||=[];p.notes[target.id].push(...notes);growPatternForNotes(p,notes);const region=project.clips.find(item=>item.id===made.clipId);if(region&&region.length<length)region.length=length;}))throw new Error('The recorded notes could not be written into the new region.');
  clientLog('midi-recording',{phase:'saved',notes:notes.length,lengthBeats:length,patternId:made.patternId});toast(`${notes.length} note${notes.length===1?'':'s'} recorded on ${take.name}.`);return true;
 }catch(error){fail(error);return false;}
 finally{endRecordingRegion();}
}
async function toggleRecord({transportStop=false}={}){
 // Logic: Record on a selected software-instrument track records MIDI; R / Record again (or Stop) ends the take.
 if(midiTake)return finishMidiRecording();
 if(!transportStop&&engine.ready&&!recordingActive()){const target=midiRecordTarget();if(target){if(modeSwitchPending||stopRequest)return toast('Wait for playback to stop before recording.');return startMidiRecording(target).catch(error=>{midiTake=null;endRecordingRegion();paintRecordingButton();fail(error);});}}
 if(!transportStop&&(modeSwitchPending||stopRequest))return toast('Wait for playback to stop before recording.');
 if(rangeBusy())return toast('Wait for the current audio range request to finish.');
 if(engine.recordingContext?.state==='stopping'||engine.recorder.state==='stopping')return;
 if(!engine.ready)return toast('Select a cloud project first.');
 try{
  if(engine.recordingContext?.state==='starting'||engine.recorder.state==='connecting'){
   Promise.resolve(engine.cancelRecording()).catch(fail);paintRecordingButton();toast('Microphone connection cancelled.');return;
  }
  if(!engine.recorder.recording){
   // Logic: record on the record-enabled track, else the selected audio track. The API take
   // is armed by startRecording (Count-in bars from the control bar) after the mic uplink opens.
   const target=recordingTarget(),countIn=logicRegionTools?.countIn,signature=$('#lcd-signature')?.textContent,wasPlaying=!!(engine.playing||engine.positionAt?.()?.playing);
   const songStartSec=wasPlaying?undefined:editCursorBeat*60/Number(project.bpm);
   const history=engine.session.rawState?.studioApi===true?recordingTakeHistory():null;recordingHistory=history;
   const starting=engine.startRecording({...target,songStartSec,...(countIn?.arm?{arm:info=>countIn.arm({...info,signature,onCountIn:detail=>countInDisplay.handle(detail)})}:{})});paintRecordingButton();
   // The region appears at the Record press (at the punch-in point), before the uplink and count-in finish.
   try{beginRecordingRegion({laneId:target.laneId,startSec:songStartSec??Number(engine.positionAt?.()?.seconds)});}catch(error){clientLog('recording-region-error',{message:String(error?.message||error).slice(0,160)});}
   let result;try{result=await starting;}catch(error){endRecordingRegion();throw error;}finally{countInDisplay.end();logicRegionTools?.paintCountIn?.();}
   paintRecordingButton();if(result.mode==='capture-upload')recordingHistory=null;else history?.prepare();
   if(result.transportStarted)adoptRecordingTransport();else if(!wasPlaying)togglePlay({fromRecord:true}).catch(fail);
   toast(result.mode==='capture-upload'?'Recording microphone for upload to Freestyle.':result.countIn?'Recording into the Freestyle cloud engine (after count-in).':'Recording into the Freestyle cloud engine.');}
  else{const history=recordingHistory;recordingHistory=null;
   // The Record undo step opens BEFORE take_stop: the finalized clip's refresh is then this step, never an outside change.
   const opened=history?.beginNow?.()??false,laneId=engine.recordingContext?.laneId;const stopping=engine.stopRecording();recordingRegion.saving();{const shown=recordingRegion.take;Promise.resolve(stopping).catch(()=>{}).finally(()=>{setTimeout(syncRecordingPrewarm,600);const timer=setTimeout(()=>{if(recordingRegion.take===shown)endRecordingRegion();},400);timer?.unref?.();});}paintRecordingButton();const ready=opened?Promise.resolve(true):history?.begin();let result;
   try{result=await stopping;}catch(error){
    await ready?.catch?.(()=>{});
    // finalizeRecording stayed uncertain (still saving / lost reply): adopt the one new clip on the take's lane, if it is there.
    const adopted=history&&(error.operationUncertain===true||error.code==='recording_take_pending'||error.code==='recording_finalize_unconfirmed')?await history.adoptNewClip(laneId).catch(()=>null):null;
    if(!adopted){history?.abort(error,{saved:error.operationCommitted===true,uncertain:error.operationUncertain===true});clientLog('recording-history',{outcome:'not-recorded',code:error.code||null});throw error;}
    result={finalized:{clipId:adopted},clipId:adopted,currentProject:true,adopted:true};
   }
   let undo=null;if(history&&result.finalized&&result.currentProject!==false){await ready;undo=await history.commit(result.clipId);}else history?.abort(new Error('The take was saved outside API recording history.'),{saved:true});
   clientLog('recording-history',{outcome:undo?.undoable?'recorded':'not-recorded',clipId:result.clipId||null,adopted:result.adopted===true,reason:undo&&!undo.undoable?String(undo.reason||'').slice(0,160):null});
   toast(result.currentProject===false?'Recording saved in its original Freestyle project.':result.placementPending||result.liveReloadPending?'Take saved in Freestyle. Its live timeline placement is waiting for engine sync.':undo&&!undo.undoable?`${result.saving?'Recording placed on its track':'Recording saved in Freestyle'} (not undoable: ${undo.reason}).`:result.saving?'Recording placed on its track. Freestyle is finishing the save…':'Recording saved in Freestyle.');
   // wait_for:"placed": the region is already on the track; Freestyle confirms the save in the background (saved:true),
   // or refuses the take (its clip is then removed and the project re-read).
   if(result.confirmation)Promise.resolve(result.confirmation).then(done=>{
    clientLog('recording-confirmed',{saved:done?.saved===true,final:done?.final===true,code:done?.error?.code||null,clipId:done?.clipId||null,ms:done?.ms??null});
    if(done?.saved===true){$('#status-message').textContent='Recording saved in Freestyle.';toast('Recording saved in Freestyle.');}
    else if(done?.final)fail(done.error);
    else{const message='Freestyle is still saving the take. The region stays on its track; refresh the project in a moment to confirm.';$('#status-message').textContent=message;toast(message);}
   }).catch(()=>{});}
 }catch(error){
  if(error.name!=='AbortError'){
   if(error.code==='recording_take_silent'){toast(error.message);$('#status-message').textContent=error.message;return;}
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
// `perform` (File ▸ Import ▸ Audio from URL…) replaces the file upload inside the same one-step import history.
async function importAudioWithHistory(file,target,options,{onImported=null,perform=null}={}){
 if(engine.session.rawState?.studioApi!==true){if(perform)throw new Error('Importing audio from a URL needs a Freestyle Studio API project.');return engine.importSample(file,target,options);}
 await engine.flush();const scope=fileImportScope(),assert=()=>{if(JSON.stringify(scope)!==JSON.stringify(fileImportScope())||!engine.ready||engine.loading)throw Object.assign(new Error('The project changed during audio import.'),{name:'AbortError'});};
 const read=async()=>{assert();const result=await engine.session.call('get_project',{project_id:scope.projectId});assert();const saved=projectPlaylistCloneRead(engine,result,scope);engine.session.rawProject=saved.rawProject;engine.session.rawState=saved.rawState;engine.session.project=saved.project;engine.accept(saved.project);};
 await read();assert();const controller=new AudioImportHistoryController({before:project,getProject:()=>project,getSaved:()=>engine.session.project,getScope:fileImportScope,read,call:(...args)=>engine.session.call(...args),flush:()=>engine.flush(),onChange:()=>mixerView?.render()}),history=engine.patternHistory,token=history.beginAudioImport(controller);let result;
 try{
  result=await (perform?perform():engine.importSample(file,target,options));assert();if(result?.persisted!==true)throw new Error('The audio import has not confirmed its saved clip. Inspect it before importing again.');
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
/* Optimistic track rows: a new or duplicated track shows at once in the first free row of the Tracks area
 * ("Creating…", controls off); the saved track replaces it when Freestyle answers, and a refused creation removes it. */
var pendingTracks=[];// `var`: the Tracks area can render (and ask for pending rows) before this line has run
function beginPendingTrack({name='New Track',kind='audio'}={}){
 const laneIds=()=>(project?.cloud?.rawProject?.lanes||[]).map(lane=>lane.id),known=new Set(laneIds());
 /* landed(): the saved track is already drawn (the creation is still confirming): the placeholder row must not show beside it */
 const entry={name:String(name||'New Track'),kind:kind==='instrument'?'instrument':'audio',landed:()=>laneIds().some(id=>!known.has(id))};pendingTracks.push(entry);paintPendingTracks();
 let done=false;return()=>{if(done)return;done=true;const at=pendingTracks.indexOf(entry);if(at>=0)pendingTracks.splice(at,1);try{renderPlaylist();}catch{}};
}
function withPendingTrack(spec,run){let done;try{done=beginPendingTrack(spec);}catch{done=()=>{};}return Promise.resolve().then(run).finally(done);}
function paintPendingTracks(){
 if(!pendingTracks?.length)return;
 const free=$$('#track-lanes .track-label.logic-track-empty');
 pendingTracks.filter(entry=>{try{return !entry.landed?.();}catch{return true;}}).forEach((entry,index)=>{
  const label=free[index];if(!label)return;const row=Number(label.dataset.track),holder=document.createElement('div');
  holder.innerHTML=logicTrackHeaderHtml({track:row,name:entry.name,kind:entry.kind});const header=holder.firstElementChild;if(!header)return;
  for(const control of header.querySelectorAll('button,input'))control.disabled=true;header.querySelector('.logic-track-knob,.logic-knob')?.classList.add('disabled');
  label.className='track-label logic-track-header logic-track-pending';label.removeAttribute('aria-hidden');label.dataset.trackKind=entry.kind;label.title=`Creating “${entry.name}” in Freestyle…`;label.setAttribute('aria-busy','true');
  label.innerHTML=header.innerHTML;const note=document.createElement('span');note.className='logic-track-pending-note';note.setAttribute('role','status');note.textContent='Creating…';label.querySelector('.logic-track-name')?.after(note);
  label.closest('.track-lane')?.classList.remove('logic-empty-row');
 });
}
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
const playlistTrackActions=new PlaylistTrackActions({read:savedRaw,call:(name,args,options)=>engine.session.call(name,args,options),projectId:()=>engine.projectId,placementBatch:(ops,options)=>engine.session.supportsPlacementBatch?.()===true?engine.session.applyPlacementBatch(ops,options):null});
function playlistTrackEditable(){return directLevelEditable()&&coreFileEditable()&&!engine.patternHistory?.optimisticPending&&!engine.patternHistory?.externalPending;}
function playlistTrackMixerRow(laneId){try{return laneId?currentMixerModel().rows.find(row=>row.kind==='lane'&&row.id===laneId)||null:null;}catch{return null;}}
function playlistTrackMenu(event,row){
 const rows=project.cloud?.timelineLaneIds||[],laneId=rows[row]||null,raw=project.cloud?.rawProject,contents=laneId&&raw?laneContents(raw,laneId):null,mixerRow=playlistTrackMixerRow(laneId),solo=mixerRow?.controls?.solo?.enabled&&mixerRow.values?.solo?.known?!!mixerRow.values.solo.value:null,muted=mixerRow?.controls?.mute?.enabled&&mixerRow.values?.mute?.known?!!mixerRow.values.mute.value:null;
 const items=playlistTrackMenuItems({row,laneId,contents,studioApi:engine.session.rawState?.studioApi===true,displayRows:rows,muted,solo,editable:playlistTrackEditable()});
 const handlers={rename:()=>renamePlaylistTrack(row),insert:()=>insertPlaylistTrack(row),duplicate:()=>duplicatePlaylistTrack(row),'duplicate-track':()=>duplicateFullPlaylistTrack(row),delete:()=>deletePlaylistTrack(row),'move-up':()=>movePlaylistTrack(row,-1),'move-down':()=>movePlaylistTrack(row,1),mute:()=>togglePlaylistTrackMute(row),solo:()=>togglePlaylistTrackSolo(row),
  'new-tracks':()=>$('#new-track').click(),'new-audio':()=>openTrackMenu('audio'),'new-instrument':()=>openTrackMenu('instrument'),'delete-unused':()=>logicKeyCommand('delete-unused-tracks')};
 clientLog('playlist-track-menu',{row,laneId,items:items.filter(Boolean).map(item=>({id:item.id,disabled:item.disabled}))});
 // Logic's track-header menu (logic-context-menu.js trackHeaderMenuItems): the reference's entries in its order, then ours.
 menu(event,trackHeaderMenuItems({base:items,kind:$(`#track-lanes .track-label[data-track="${row}"]`)?.dataset.trackKind||null,editable:playlistTrackEditable(),run:handlers}));
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
async function deletePlaylistTrack(row){
 if(laneMoveBusy||!playlistTrackEditable())throw new Error('Wait for the current cloud operation to finish.');
 const laneId=project.cloud?.timelineLaneIds?.[row];if(!laneId)throw new Error('This Playlist row has no saved track.');
 const shown=laneContents(project.cloud.rawProject,laneId),name=project.trackNames?.[row]||`Track ${row+1}`;
 // FL asks only when the track holds something; Undo restores the same lane and clips either way.
 if(!shown.empty&&!await confirmPlaylistTrackDelete(name,shown.clipIds.length))return null;
 laneMoveBusy=true;let pending=null,state=null;
 try{
  await engine.flush();pending=engine.patternHistory.beginExternalStep({kind:'lane_delete',label:'Delete Track'});
  state=await playlistTrackActions.deleteLane(laneId);renderAll();
  const undo=async()=>{const result=await playlistTrackActions.restoreLane(state);renderAll();clientLog('playlist-track-restore',{laneId,clipIds:result.clipIds.length,liveApplied:result.liveEngine?.applied??null,chainRestored:result.liveEngine?.chainRestored??null,reason:result.liveEngine?.reason??null});if(result.liveChainRestored===false)toast(`${name} is restored, but its effects did not reload in the running session. Reload the project to hear them.`);return result;};
  const redo=async()=>{const next=await playlistTrackActions.deleteLane(laneId,{expect:state});state=next;renderAll();return{laneId,clipIds:next.clipIds};};
  engine.patternHistory.finishExternalStep(pending,{detail:{laneId,row,clipIds:state.clipIds},undo,redo});pending=null;
  clientLog('playlist-track-delete',{row,laneId,clipIds:state.clipIds.length});toast(`${name} deleted.`);return state;
 }catch(error){clientLog('playlist-track-delete-failed',{row,laneId,error:String(error?.message||error).slice(0,200),uncertain:error?.operationUncertain===true});if(pending)engine.patternHistory.failExternalStep(pending,error);pending=null;await engine.refresh().catch(()=>{});renderAll();throw error;}
 finally{if(pending)engine.patternHistory.failExternalStep(pending,{operationUncertain:true});laneMoveBusy=false;}
}
/** Logic Track ▸ New Track with Duplicate Settings (⌘D): a new EMPTY track of the same type
 * directly below, with the same channel strip (instrument + patch state, effects, sends,
 * volume, pan, output; Logic never copies regions). Freestyle duplicateLane copies the strip,
 * then the copied regions / pattern copies / pattern row are removed (playlist-track-menu.js).
 * One history step: Undo deletes the new track only while it is still empty and unchanged,
 * Redo runs the same ⌘D again. */
async function duplicatePlaylistTrack(row){
 if(laneMoveBusy||!playlistTrackEditable())throw new Error('Wait for the current cloud operation to finish.');
 const laneId=project.cloud?.timelineLaneIds?.[row];if(!laneId)throw new Error('This row has no saved track.');
 const blocked=duplicateSettingsBlockReason(laneContents(project.cloud.rawProject,laneId));if(blocked)throw new Error(blocked);
 const name=project.trackNames?.[row]||`Track ${row+1}`;laneMoveBusy=true;let pending=null,created=null;
 const selectedBefore=logicShell?.state?.selectedTrack,pendingRow=beginPendingTrack({name,kind:(project.cloud?.rawProject?.lanes||[]).find(lane=>lane.id===laneId)?.kind});
 try{
  await engine.flush();pending=engine.patternHistory.beginExternalStep({kind:'lane_duplicate',label:'New Track with Duplicate Settings'});
  created=await playlistTrackActions.duplicateSettings(laneId);pendingRow();renderAll();
  const undo=async()=>{const removed=await playlistTrackActions.removeDuplicate(created);renderAll();return{laneId:created.laneId,clipIds:removed?.clipIds??[]};};
  const redo=async()=>{const result=await playlistTrackActions.redoDuplicate(created);renderAll();return result;};
  engine.patternHistory.finishExternalStep(pending,{detail:{laneId:created.laneId,sourceLaneId:laneId,row},undo,redo});pending=null;
  const newRow=(project.cloud?.timelineLaneIds||[]).indexOf(created.laneId);/* a header clicked meanwhile keeps its selection */if(newRow>=0&&logicShell?.state?.selectedTrack===selectedBefore)logicShell?.selectTrack?.(newRow);
  clientLog('playlist-track-duplicate',{row,laneId,newLaneId:created.laneId,renderedRow:newRow,notCopied:created.notCopied,timings:created.timings,liveApplied:created.liveEngine?.applied??null,engineReloadRequired:created.engineReloadRequired});
  toast(created.notCopied.length?`New track with ${name}’s settings added. Not copied: ${created.notCopied.join(', ')}.`:created.engineReloadRequired?`New track with ${name}’s settings added. Reload the project to hear its effects.`:`New track with ${name}’s settings added.`);return created;
 }catch(error){pendingRow();clientLog('playlist-track-duplicate-failed',{row,laneId,error:String(error?.message||error).slice(0,200),uncertain:error?.operationUncertain===true,rolledBack:error?.rolledBack===true});if(pending)engine.patternHistory.failExternalStep(pending,error);pending=null;await engine.refresh().catch(()=>{});renderAll();throw error;}
 finally{if(pending)engine.patternHistory.failExternalStep(pending,{operationUncertain:true});laneMoveBusy=false;}
}
/** Logic Track ▸ Duplicate Track: a full copy directly below (regions, channel strip; an
 * instrument's pattern copies on their own new pattern row, shown in the Step Sequencer
 * after the confirming read). One history step: Undo deletes the copy while unchanged,
 * Redo restores that same audio copy (restoreLane) or duplicates again. */
async function duplicateFullPlaylistTrack(row){
 if(laneMoveBusy||!playlistTrackEditable())throw new Error('Wait for the current cloud operation to finish.');
 const laneId=project.cloud?.timelineLaneIds?.[row];if(!laneId)throw new Error('This row has no saved track.');
 const blocked=duplicateBlockReason(laneContents(project.cloud.rawProject,laneId));if(blocked)throw new Error(blocked);
 const name=project.trackNames?.[row]||`Track ${row+1}`;laneMoveBusy=true;let pending=null,copy=null;
 const selectedBefore=logicShell?.state?.selectedTrack,pendingRow=beginPendingTrack({name,kind:(project.cloud?.rawProject?.lanes||[]).find(lane=>lane.id===laneId)?.kind});
 try{
  await engine.flush();pending=engine.patternHistory.beginExternalStep({kind:'lane_duplicate_track',label:'Duplicate Track'});
  copy=await playlistTrackActions.duplicateLane(laneId);pendingRow();renderAll();
  const undo=async()=>{const removed=await playlistTrackActions.removeTrackCopy(copy);renderAll();return removed;};
  const redo=async()=>{const result=await playlistTrackActions.redoTrackCopy(copy);renderAll();return result;};
  engine.patternHistory.finishExternalStep(pending,{detail:{laneId:copy.laneId,sourceLaneId:laneId,row},undo,redo});pending=null;
  const newRow=(project.cloud?.timelineLaneIds||[]).indexOf(copy.laneId);if(newRow>=0&&logicShell?.state?.selectedTrack===selectedBefore)logicShell?.selectTrack?.(newRow);
  clientLog('playlist-track-duplicate-full',{row,laneId,newLaneId:copy.laneId,rowLaneId:copy.rowLaneId,clips:copy.clipIds.length,patterns:copy.patternIds.length,placements:copy.placementIds.length,renderedRow:newRow,timings:copy.timings,liveApplied:copy.liveEngine?.applied??null,notCopied:copy.notCopied});
  toast(`${name} duplicated.${copy.notCopied.length?` Not copied: ${copy.notCopied.join(', ')}.`:''}`);return copy;
 }catch(error){pendingRow();clientLog('playlist-track-duplicate-full-failed',{row,laneId,error:String(error?.message||error).slice(0,200),uncertain:error?.operationUncertain===true});if(pending)engine.patternHistory.failExternalStep(pending,error);pending=null;await engine.refresh().catch(()=>{});renderAll();throw error;}
 finally{if(pending)engine.patternHistory.failExternalStep(pending,{operationUncertain:true});laneMoveBusy=false;}
}
function confirmPlaylistTrackDelete(name,clips){return new Promise(resolve=>{const d=dialog('Delete track',`<form><p>Delete <b>${esc(name)}</b> and its ${clips} audio clip${clips===1?'':'s'}? Undo restores them.</p><button type="submit" class="primary">Delete</button><button type="button" class="cancel">Cancel</button></form>`);let done=false;const finish=value=>{if(done)return;done=true;resolve(value);if(d.open)d.close();else d.remove();};d.addEventListener('close',()=>finish(false));d.querySelector('form').onsubmit=e=>{e.preventDefault();finish(true);};d.querySelector('.cancel').onclick=()=>finish(false);});}
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
async function createLaneWithHistory(options,{instrument=false,onCreated=null}={}){
 const create=()=>instrument?emptyInstrument.create(options):laneCreate.create(options);
 if(engine.session.rawState?.studioApi!==true)return create();
 await engine.flush();const scope=fileImportScope(),assert=()=>{if(JSON.stringify(scope)!==JSON.stringify(fileImportScope())||!engine.ready||engine.loading)throw Object.assign(new Error('The project changed during track creation.'),{name:'AbortError'});};
 const read=async()=>{assert();const result=await engine.session.call('get_project',{project_id:scope.projectId});assert();const saved=projectPlaylistCloneRead(engine,result,scope);engine.session.rawProject=saved.rawProject;engine.session.rawState=saved.rawState;engine.session.project=saved.project;engine.accept(saved.project);};
 await read();assert();const controller=new LaneCreateHistoryController({before:project,getProject:()=>project,getScope:fileImportScope,read,call:(...args)=>engine.session.call(...args),flush:()=>engine.flush(),onChange:()=>mixerView?.render()}),history=engine.patternHistory,token=history.beginLaneCreate(controller);let receipt;
 try{
  receipt=await create();assert();const laneId=receipt?.laneId??receipt?.lane?.id;try{if(laneId)onCreated?.(laneId);}catch{}if(instrument?receipt?.emptyConfirmed!==true:receipt?.status!=='confirmed')throw new Error('The new track has not confirmed its saved empty lane. Inspect tracks before creating another.');
  if(!instrument){
   const initialized=await engine.session.action('load_lane_chain',{lane_id:laneId,...(typeof receipt.lane?.name==='string'&&receipt.lane.name?{name:receipt.lane.name}:{})},{refresh:false});assert();
   if(initialized?.ok!==true||initialized.lane_id!==laneId||!Number.isSafeInteger(initialized.mozart_track_id)||initialized.mozart_track_id<0||!Array.isArray(initialized.plugins)||!Array.isArray(initialized.skipped)||initialized.skipped.length)throw new Error('The track is saved, but its native chain initialization is unconfirmed. Inspect tracks before using its history.');
   await engine.session.refresh({native:true});assert();const state=engine.session.rawState,loaded=state?.session,collection=state?.tracks,rows=collection?.tracks,matches=Array.isArray(rows)?rows.filter(row=>row?.db_track_id===laneId):[],restore=loaded?.instrument_restore;
   if(state?.studioApi!==true||state.projectId!==scope.projectId||loaded?.projectId!==scope.projectId||loaded.ok!==true||loaded.fullyLoaded!==true||collection?.ok!==true||collection.live!==true||collection.runtime_ids_available!==true||matches.length!==1||!Number.isSafeInteger(matches[0].id)||matches[0].id<0||matches[0].pending_restore===true||matches[0].restore_failed===true||rows.filter(row=>row?.id===matches[0].id).length!==1||restore&&(restore.settled!==true||restore.pending!==0||restore.failed!==0))throw new Error('The track is saved, but its native initialization is unconfirmed. Inspect tracks before using its history.');
  }else if(receipt.pluginConfirmed!==true){
   const error=new Error('The instrument is saved, but its native initialization is unconfirmed. Inspect tracks before using its history.');controller.failCreate({attempted:true,committed:true,uncertain:false,explicitRejection:false,error});history.failLaneCreate(token,error);return receipt;
  }
  await controller.fresh();controller.adopt({after:project,laneId});history.finishLaneCreate(token);audioRangeRevision++;return receipt;
 }catch(error){
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
function shortcuts(){if(window.vegetableStudio?.logicShell)return window.vegetableStudio.logicShell.openHelp();dialog('Trashlab',`<p>A web studio for the Freestyle cloud DAW.</p><div class="shortcuts"><span>Start / stop playback</span><kbd>Space</kbd><span>Start / pause playback</span><kbd>Ctrl/⌘ Space</kbd><span>Playlist cursor to start</span><kbd>Home</kbd><span>Zoom focused Playlist / Piano roll</span><kbd>Page Up / Page Down</kbd><span>Playlist / Channel rack / Piano roll / Mixer</span><kbd>F5 / F6 / F7 / F9</kbd><span>Save project</span><kbd>⌘ S</kbd><span>Undo / Redo</span><kbd>⌘ Z / ⌘ ⇧ Z</kbd><span>Playlist tools (typing off)</span><kbd>P B D C E S T Z Y</kbd><span>Piano draw / paint / delete / slice / select / zoom / scrub</span><kbd>P B D C E Z Y</kbd><span>Typing keyboard on / off (Ctrl+T on Mac too: the browser reserves ⌘T for a new tab, so native FL’s ⌘T is unavailable here)</span><kbd>Ctrl T</kbd><span>Import MIDI in Piano roll</span><kbd>Ctrl/⌘ M</kbd><span>Zoom rectangle / restore view</span><kbd>Z drag / right-click</kbd><span>Select playlist clips</span><kbd>Ctrl/⌘ click or drag</kbd><span>Toggle / add playlist selection</span><kbd>Ctrl/⌘ ⇧ click or drag</kbd><span>Clone playlist clip or selected clips</span><kbd>⇧ click or drag clip body</kbd><span>Select piano notes</span><kbd>Ctrl/⌘ drag or click</kbd><span>Clone piano note or selected notes</span><kbd>⇧ click or drag note body</kbd><span>Copy / paste notes</span><kbd>⌘ C / ⌘ V</kbd><span>Quick quantize note starts</span><kbd>Shift Q</kbd><span>Quantize notes</span><kbd>Alt Q</kbd><span>Move selected notes</span><kbd>Arrow keys</kbd><span>Delete selected clips, notes or channel scores</span><kbd>Delete / Backspace (Mac Delete)</kbd><span>Toggle global snap / None</span><kbd>⇧ Backspace</kbd><span>Play instrument · native Piano layout</span><kbd>Z X C V B N M · Q W E R T Y U I</kbd><span>Zoom at cursor</span><kbd>Ctrl / ⌘ / Alt + wheel</kbd><span>Scroll horizontally</span><kbd>Shift + wheel</kbd></div><p>Playlist: P Draw, B Paint, D Delete, C Slice, E Select, S Slip, T Mute, Z Zoom, Y Playback. T currently mutes pattern clips; Y starts the arrangement from empty Playlist space. Isolated clip audition is unavailable. Turn off typing keyboard for single-letter tools. Drag clip edges to trim; right-click items for more controls.</p><button id="help-engine">Freestyle tools</button>`).querySelectorAll('button').forEach(b=>{if(b.id==='help-engine')b.onclick=()=>openCloudPanel();});}

// ── Illogic: Logic Pro application menus (File / Edit / Track / Navigate / Record / Mix / View / Window, plus a
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
 return current.saves.slice(0,25).map(save=>({label:saveLabel(save),run:()=>revertToSave(save)}));
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
function openTrackMenu(kind){if(!engine.ready)return openCloudPanel();if(kind==='instrument')requireUiFeature('create_instrument');return laneCreateDialog.open({kind});}
function addMenuEntries({rack=false}={}){
 const drum=project.cloud?.rawState?.studioApi===true?uiFeature('add_drum_channel'):{enabled:true},roles=types=>types.map(type=>[type[0].toUpperCase()+type.slice(1),'',()=>addChannel(type),!drum.enabled,drum.enabled?'':drum.reason]),audioImport=['Import audio…','',()=>{importedTarget=null;$('#import-audio').click();}];
 if(project.cloud?.rawState?.studioApi===true)return[['New audio track…','',()=>openTrackMenu('audio')],['New vocal track…','',()=>openTrackMenu('vocal')],['Add instrument…','',()=>openTrackMenu('instrument')],null,...roles(['kick','clap','hat','snare']),null,rack?['Add sample from disk…','',()=>{importedTarget=RACK_UPLOAD_TARGET;$('#import-audio').click();}]:audioImport];
 return rack?[...roles(['kick','clap','hat','snare','bass','keys','pad','piano']),audioImport]:[['New track…','',()=>$('#new-track').click()],audioImport,...roles(['kick','clap','hat','snare','bass','keys','pad','piano'])];
}
function logicGoToPosition(){return textDialog('Go to Position','Bar (or bar.beat)',String(Math.floor(editCursorBeat/4)+1),value=>{const match=/^\s*(\d+)(?:[ .:](\d+))?\s*$/.exec(String(value));if(!match)return toast('Enter a bar number, or bar.beat (for example 5 or 5.3).');playlistCursorJump((Math.max(1,Number(match[1]))-1)*4+Math.max(0,Math.min(3,Number(match[2]||1)-1)));});}
/** A menu entry Logic has and Freestyle cannot do: listed in place, disabled, with the reason as its tooltip. */
const menuOff=(label,title,shortcut='')=>({label,shortcut,disabled:true,title});
const NO_MENU={template:'Freestyle has no project templates.',movie:'Freestyle projects have no movie track.',marker:'Freestyle projects have no markers.',global:'Freestyle projects have no global tracks.',stack:'Freestyle has no track stacks.',hide:'Freestyle cannot hide tracks.',sort:'Tracks keep the order you drag them into.',score:'There is no Score Editor.',list:'There are no List Editors.',group:'Freestyle has no mixer groups.',auto:'Add, move and delete automation points in the track’s automation lane (A).',os:'macOS and the browser own this window command.',take:'Freestyle keeps one recording per region; there are no take folders.',share:'Use Freestyle ▸ Share for the project link and collaborators.',place:'Freestyle bounces the whole mix (⌘B); bounce in place is not available.',exportTrack:'Freestyle bounces the whole mix (⌘B); per-track export is not available.'};
function newProjectDialog(){return(()=>{const d=dialog('New Project',`<p>Create a new Freestyle cloud project. Your current project stays in your Freestyle library.</p><button id="new-save">Save current project</button><button id="new-create" class="primary">Create empty project</button>`);d.querySelector('#new-save').onclick=saveProject;d.querySelector('#new-create').onclick=()=>{textDialog('New Project','Project title','Untitled session',title=>engine.create(title).catch(fail));d.close();};})();}
/** True when a press of Undo / Redo would have a step to apply (any history owner), so the menus can grey the entry. */
function historyAvailable(direction){
 const redo=direction==='redo';
 try{
  if(!engine.ready)return false;
  if(clipboardUncertain())return true;// the press explains what to reload
  if(redo?audioClipMutes.canRedo(audioClipMuteContext()):audioClipMutes.canUndo(audioClipMuteContext()))return true;
  if(!redo&&regionEffects?.canUndo())return true;
  if(audioSliceHistoryEntry(redo?'redo':'undo'))return true;
  if(redo?(clipboardHistoryEntry(true)&&!clipboardHistoryEntry(true).applied):clipboardHistoryEntry()?.applied)return true;
  if(sliceOwnsHistory(redo))return true;
  if(!redo&&(engine.pending||engine.inFlight||engine.applying||historyStepWaits()))return true;// an edit still saving becomes the step
  // The retained journal: any recorded step on that side counts (its scope is re-checked by the press itself, so a
  // journal that is momentarily out of scope must not grey a step that the press would still apply).
  const journal=engine.patternHistory,entries=Array.isArray(journal?.entries)?journal.entries.length:0,index=Number(journal?.index)||0;
  if(redo?index<entries:index>0)return true;
  const state=journal?.snapshot?.();if(state?.busy||(redo?state?.canRedo:state?.canUndo))return true;
  // No retained step. Freestyle's native history does not undo Studio API edits (cloud-engine.js history()), so there is nothing to apply there.
  if(engine.session.rawState?.studioApi===true)return false;
  return uiFeature(redo?'native_redo':'native_undo',{localHistory:{undo:false,redo:false}}).enabled===true;
 }catch{return true;}
}
/** File ▸ Import ▸ Other… (⌘I): one picker for every importable file; the file type decides the import. */
function importAnyFile(){
 const input=document.createElement('input');input.type='file';input.accept='.mid,.midi,audio/*,.wav,.aif,.aiff,.mp3,.m4a,.flac,.ogg,.flp,.zip,.logicx';
 input.onchange=()=>{const file=input.files?.[0];if(!file)return;try{
  if(/\.midi?$/i.test(file.name))return void midiImport(file).catch(fail);
  const target=$(/\.(flp|zip|logicx)$/i.test(file.name)?'#import-project':'#import-audio');if(target.id==='import-audio')importedTarget=null;
  const transfer=new DataTransfer();transfer.items.add(file);target.files=transfer.files;target.dispatchEvent(new Event('change',{bubbles:true}));
 }catch(error){fail(error);}};
 input.click();
}
/* The Tracks-area local Edit menu and the Freestyle menu (everything the reference menu bar has no entry for).
 * The application menus themselves are logic-main-menus.js (see menuItems below). */
const legacyMenuItems={
 Edit:()=>{const anySelected=playlistSelection.ids.size>0,none=anySelected?'':'Select one or more regions first.',key=(label,shortcut,name,args=[],needsSelection=true)=>({label,shortcut,run:()=>logicKeyCommand(name,args),disabled:needsSelection&&!anySelected,title:needsSelection?none:''});
 return[['Undo','⌘Z',undo,!historyAvailable('undo'),historyAvailable('undo')?'':'There is nothing to undo.'],['Redo','⇧⌘Z',redo,!historyAvailable('redo'),historyAvailable('redo')?'':'There is nothing to redo.'],['Undo History…','⌃⌥⌘Z',undoHistoryDialog],menuOff('Delete Undo History…','The session history is cleared when the project is reloaded.'),null,
  ['Cut','⌘X',()=>playlistClipboardAction('cut'),!anySelected],['Copy','⌘C',()=>playlistClipboardAction('copy'),!anySelected],['Paste','⌘V',()=>playlistClipboardAction('paste')],menuOff('Paste Replace','Paste always adds; delete the old regions first.','⇧⌘V'),menuOff('Paste at Original Position','Paste places regions at the playhead.'),['Delete','⌫',deleteSelected,!anySelected],menuOff('Delete and Move','Freestyle does not close the gap after a delete.'),['Select All','⌘A',()=>{playlistSelection.select(allClips().map(c=>c.id));selectedClip=playlistSelection.ids.values().next().value||null;paintPlaylistSelection();}],
  {label:'Select',submenu:[key('All Following','⇧F','select-following'),key('All Following of Same Track','⌃⇧F','select-following',['same']),key('All Inside Locators','⇧L','select-inside-locators',[],false),key('Overlapped Regions','⇧O','select-overlapped',[],false),key('Muted Regions','⇧M','select-muted',[],false),key('Equal Regions','⇧E','select-equal'),key('Similar Regions','⇧S','select-equal'),menuOff('Same-Colored Regions','Freestyle regions have no colour field.','⇧C'),null,key('Invert Selection','⇧I','invert-selection',[],false),key('Deselect All','⇧D','deselect-all',[],false)]},null,
  {label:'Split',submenu:[{label:'Regions at Playhead',shortcut:'⌘T',run:()=>logicShell.splitAtPlayhead(),disabled:!anySelected,title:none},key('Regions at Locators','⌥⌘T','split-at-locators')]},
  {label:'Join',submenu:[menuOff('Regions','Freestyle has no region join operation.','⌘J'),menuOff('Regions per Tracks','Freestyle has no region join operation.','J')]},
  {label:'Repeat',shortcut:'⌘R',run:()=>queuePlaylistDuplicate(),disabled:!anySelected,title:none},menuOff('Repeat Multiple…','Press ⌘R once per repeat.'),
  {label:'Move',submenu:[key('To Playhead',';','move-to-playhead'),key('To Focused Track','⌃⇧T','move-to-selected-track'),key('Nudge Left','⌥←','nudge',['-1']),key('Nudge Right','⌥→','nudge',['1']),menuOff('To Recorded Position','Freestyle keeps no recorded timestamp on regions.','⌥⇧⌘R'),menuOff('Shuffle Left','Freestyle has no shuffle edit.','⌥['),menuOff('Shuffle Right','Freestyle has no shuffle edit.','⌥]')]},
  {label:'Trim',submenu:[key('Start to Playhead','⌘[','trim-to-playhead',['start']),key('End to Playhead','⌘]','trim-to-playhead',['end']),key('Region End to Next Region','⇧\\','trim-end-to-next'),key('Remove Overlaps','\\','remove-overlaps'),key('Crop Outside Locators','⌘\\','crop-to-locators'),menuOff('Fill within Locators','Freestyle has no fill-to-locators trim.','⌥\\'),menuOff('Start to Previous Transient','Freestyle does not expose audio transients.','⌃⇧['),menuOff('End to Next Transient','Freestyle does not expose audio transients.','⌃]')]},
  {label:'Convert',submenu:[key('Regions to New Regions','⌥⌘R','make-unique'),menuOff('Audio Region to New Audio File…','Freestyle has no region-to-file conversion.','⌥⌘F'),menuOff('Loops to Regions','Freestyle regions have no loop flag.','⌃⌘L'),menuOff('To MIDI Region','Open a pattern region in the Piano Roll (P) to edit it as MIDI.','⌃⌥⌘M'),menuOff('Audio Region to Sampler Zone…','Use the region menu ▸ Add to Step Sequencer.','⌃E')]},
  {label:'Bounce and Join',submenu:[menuOff('Bounce in Place…',NO_MENU.place,'⌃B'),menuOff('Join','Freestyle has no region join operation.','⌘J')]},null,
  {label:'Cut/Insert Time',submenu:[menuOff('Cut Section Between Locators','Freestyle has no global section edits.','⌃⌘X'),menuOff('Insert Silence Between Locators','Freestyle has no global section edits.','⌃⌘I'),menuOff('Insert Section at Playhead','Freestyle has no global section edits.','⌃⌘V'),menuOff('Repeat Section Between Locators','Freestyle has no global section edits.','⌃⌘R')]},
  {label:'Tempo',submenu:[['Tempo & Time Signatures…','⌥⇧T',()=>timingDialog.open()],menuOff('Adjust Tempo using Region Length and Locators','Freestyle has no tempo detection from a region.'),menuOff('Adjust Tempo using Beat Detection…','Freestyle has no tempo detection from a region.')]}];},
 // Everything Logic has no menu entry for lives here, grouped by the Logic menu it relates to.
 Freestyle:()=>{const metronome=metronomeState();const row=selectedTrackRow(),laneId=row===null?null:project.cloud.timelineLaneIds[row],strip=id=>{if(!laneId)return{disabled:true,title:'Select a track first (click its header).'};const item=channelStripSettingEntries(laneId).find(entry=>entry.id===id);return item?{disabled:!!item.disabled,title:item.title||''}:{disabled:true,title:'Not available for this track.'};};const entries=addMenuEntries().filter(item=>item&&!/^Import audio/.test(item[0])),rows=entries.filter(item=>!/track…$|instrument…$/i.test(item[0])),recovery=[['Reload Tracks area clipboard state','',()=>inspectPlaylistClipboard().catch(fail),workspaceBusy()||!clipboardUncertain()],['Reload audio slice state','',()=>reloadAudioSlice().catch(fail),workspaceBusy()||!audioSliceEntry()],['Undo audio range','',()=>rangeEdits.undoLast(),!rangeEdits.canUndo()],['Reload audio range state','',()=>rangeEdits.reloadLast(),rangeBusy()||!rangeEdits.hasReceipt()],['Reload slice state','',reloadSliceState,sliceBusy()||!sliceRecoveryController()]];;
 return[...(embeddedInFreestyle()?[['Mozart AI…','',()=>openFreestyleMozart()],null]:[]),['Freestyle Cloud Engine…','',()=>openCloudPanel()],['Assistant…','',()=>openCloudTool('mozart_ai_command')],freestyleExtras.item('assistantJobs'),freestyleExtras.item('undoAssistant'),{label:'Analyze Key…',run:()=>logicRegionTools.analyzeKey(),disabled:restMixer?.isRestMode!==true||!engine.ready,title:restMixer?.isRestMode===true?'Detect the key of the selected audio region (or the backing track), then set the project key.':'Key analysis needs a Studio API (OAuth) project.'},['Import YouTube Backing Track…','',()=>openCloudTool('import_youtube_backing')],null,['Listen to Cloud-Rendered Preview','',()=>freestyleExtras.listen().catch(fail)],['Audio Engine Information','',()=>dialog('Audio engine',`<p>Freestyle cloud DAW · ${engine.sampleRate||48000} Hz · WebRTC monitoring</p><p>Audio generation, sequencing, mixing and rendering run on Freestyle. This browser sends controls and receives the cloud audio stream.</p>`)],null,
  {label:'Project',submenu:[...(embeddedInFreestyle()?[['Share Project…','',()=>openFreestyleShare()]]:[]),['Copy Project Link','',copyProjectLink,!engine.ready],['Share Settings…','',shareSettingsDialog,!engine.ready],['Invite Collaborator…','',inviteCollaboratorDialog,!engine.ready],freestyleExtras.item('collaborators'),null,['Reset Share Link…','',resetShareLink,!engine.ready]]},
  {label:'Edit',submenu:[['Audio Time Range…','',()=>rangeEdits.open(),workspaceBusy()||rangeBusy()||sliceBusy()],['Fade Tool','T A',()=>window.illogic.selectFadeTool()],['Region Automation…','',()=>openAutomation().catch(fail)],['Delete All Pattern Regions…','',()=>clearPlaylistConfirm()],{label:'Cloud Edit Recovery',submenu:recovery,disabled:recovery.every(item=>item[3]),title:'Inspect a Freestyle edit whose result was not confirmed. Nothing is repeated.'}]},
  {label:'Track',submenu:[['New Vocal Track…','',()=>openTrackMenu('vocal')],...rows.length?[{label:'New Step Sequencer Row',submenu:rows}]:[],['Tempo & Time Signatures…','',()=>timingDialog.open()],['Freestyle Instruments…','',()=>openCloudPanel()]]},
  {label:'Transport',submenu:[{label:'Cycle',shortcut:loopStateKnown()?'C':'Unknown',checked:loopStateKnown()?!!engine.session.positionAt().loopEnabled:undefined,run:toggleLoopPlayback},['Set Locators…','',()=>playlistLoop.open()],{label:'Play from Selection',shortcut:'⇧Space',title:'Play the selected regions once (Freestyle play range); Stop works as usual.',run:()=>playFromSelection()},{label:'Metronome Click',shortcut:metronome.actual===null?'Unknown':'K',checked:metronome.actual===null?undefined:!!metronome.actual,run:toggleMetronomeUi,disabled:!!metronome.busy||!engine.ready},['MIDI Keyboard Input',midiInputLabel(),toggleMidiInput,!midiInput?.supported],{label:'Send All Notes Off (MIDI Panic)',shortcut:'■■',title:'Silence every instrument (also: double-click Stop). Not an undo step.',disabled:!engine.ready,run:()=>midiPanic()}]},
  {label:'Mix',submenu:[['Mixer Slots and Routing…','',()=>openSelectedMixerTools().catch(fail)],['Create Bus…','',()=>window.illogic.createBus()],{label:'Copy Channel Strip Setting',shortcut:'⌥⌘C',run:()=>window.illogic.copyChannelStripSetting(laneId),...strip('copy-strip')},{label:'Paste Channel Strip Setting',shortcut:'⌥⌘V',run:()=>window.illogic.pasteChannelStripSetting(laneId),...strip('paste-strip')}]},
  {label:'View',submenu:[['Zoom to Fit','Z',()=>fitPlaylistView()],['Use Both Mouse Buttons in Step Sequencer',useBothStepButtons?'On':'Off',toggleStepMouseButtons],['Reset Layout','',()=>{$$('.floating-window,.playlist-window').forEach(w=>{w.classList.remove('expanded');for(const key of ['left','top','right','bottom','width','height','transform','position','margin','willChange'])w.style[key]='';});pianoMaximizedView=null;syncPianoMaximizeButton();showWindow('rack');showWindow('mixer');}],...(embeddedInFreestyle()?[null,...STUDIO_VIEWS.map(([id,label])=>({label:`${label} View`,checked:activeStudioView()===id,run:()=>switchStudioView(id)}))]:[])]}];}};
/* Illogic: the application menus (logic-main-menus.js) follow the reference menu bar entry by entry; data-menu is the menu name.
 * TracksEdit is the Tracks-area local Edit menu; Freestyle holds everything the reference has no entry for. */
const menuItems={
 ...logicMainMenus({
  command:(name,args=[])=>logicKeyCommand(name,args),
  newProject:newProjectDialog,open:()=>openCloudPanel(),save:saveProject,saveAs:()=>openRangeSafeSaveAs({engine,getProject:()=>project,dialog,openLibrary:()=>openCloudPanel(),onStatus:toast}),
  revertItems:()=>{if(!projectSavesFresh())loadProjectSaves().then(()=>refreshMainMenu('File'));return revertMenuItems();},renameProject:projectInfo,
  audioInfo:()=>dialog('Audio engine',`<p>Freestyle cloud DAW · ${engine.sampleRate||48000} Hz · WebRTC monitoring</p><p>Audio generation, sequencing, mixing and rendering run on Freestyle. This browser sends controls and receives the cloud audio stream.</p>`),
  openRecordMenu:()=>openMainMenu('Record'),midiLabel:()=>midiInputLabel(),toggleMidi:toggleMidiInput,midiSupported:()=>!!midiInput?.supported,
  importAudio:importAudioFile,importMidi:()=>midiImport(),importOther:importAnyFile,exportSelectionMidi,noMidiSelection:()=>!(project.clips||[]).some(clip=>clip.patternId&&playlistSelection.ids.has(clip.id)),exportAllMidi:midiExport,bounce:exportWav,
  undo,redo,canUndo:()=>historyAvailable('undo'),canRedo:()=>historyAvailable('redo'),undoHistory:undoHistoryDialog,
  cut:()=>playlistClipboardAction('cut'),copy:()=>playlistClipboardAction('copy'),paste:()=>playlistClipboardAction('paste'),delete:deleteSelected,anySelected:()=>playlistSelection.ids.size>0,
  selectAll:()=>{playlistSelection.select(allClips().map(c=>c.id));selectedClip=playlistSelection.ids.values().next().value||null;paintPlaylistSelection();},
  newTracks:()=>$('#new-track').click(),newAudioTrack:()=>openTrackMenu('audio'),newInstrumentTrack:()=>openTrackMenu('instrument'),
  noTrack:()=>selectedTrackRow()===null?'Select a track first (click its header).':null,mixerFocused:()=>activeEditor()==='mixer',
  duplicateBlock:()=>{const row=selectedTrackRow(),laneId=row===null?null:project.cloud.timelineLaneIds[row],kind=laneId?(project.cloud?.rawProject?.lanes||[]).find(lane=>lane.id===laneId)?.kind:null;return(row===null?'Select a track first (click its header).':null)||(laneId&&project.cloud?.rawProject?duplicateSettingsBlockReason(laneContents(project.cloud.rawProject,laneId)):null)||(kind?null:'Select a saved track first.');},
  duplicateTrack:()=>withSelectedTrack('New Track With Duplicate Settings',duplicatePlaylistTrack),duplicateTrackContent:()=>withSelectedTrack('New Track With Duplicate Settings and Content',duplicateFullPlaylistTrack),
  renameTrack:renameSelectedTrack,deleteTrack:()=>withSelectedTrack('Delete Track',deletePlaylistTrack),timing:()=>timingDialog.open(),
  goToPosition:()=>logicGoToPosition(),setLocators:rounded=>{const sel=allClips().filter(c=>playlistSelection.ids.has(c.id));if(!sel.length)return toast('Select regions to set the locators.');const start=Math.min(...sel.map(c=>c.start)),end=Math.max(...sel.map(c=>c.start+c.length));return playlistLoop.apply(rounded?{enabled:true,startBeat:Math.floor(start/4+1e-6)*4,endBeat:Math.max(4,Math.ceil(end/4-1e-6)*4)}:{enabled:true,startBeat:start,endBeat:end});},
  countIn:()=>{const countIn=logicRegionTools?.countIn,state=countIn?.state?.()||{enabled:false,bars:0,reason:'Count-in is unavailable.'};return{choices:COUNT_IN_BAR_CHOICES.map(bars=>({bars,checked:state.enabled&&state.bars===bars,disabled:!state.enabled||!!(engine.recorder?.recording||engine.recordingContext),title:state.reason||'',run:()=>{try{countIn.setBars(bars);toast(`Count-in: ${countInLabel(bars)}`);}catch(error){toast(error.message);}logicRegionTools?.paintCountIn?.();}}))};},
  automationShown:()=>!!$('#playlist')?.classList.contains('logic-automation-view'),toggleAutomation:()=>toggleAutomationView(),addPlugin:()=>openSelectedMixerTools().catch(fail),
  pane:name=>!!logicShell?.state?.panes?.[name],togglePane:name=>logicShell?.togglePane(name),mixerVisible:()=>!!$('#mixer')&&!$('#mixer').classList.contains('hidden'),toggleMixer:()=>toggleMixer(),
  editorVisible:()=>['piano','rack','audio-editor'].some(id=>!!$('#'+id)&&!$('#'+id).classList.contains('hidden')),toggleEditor:()=>$('.logic-view-buttons [data-window="piano"]')?.click(),notePadReason:NOTE_PAD_UNAVAILABLE,fullScreen:()=>logicKeyCommand('full-screen'),
  pianoFocused:()=>activeEditor()==='piano',openMixer:()=>toggleMixer(true),openEditor:kind=>openEditorPane(kind),openTransform:()=>window.illogic.openHumanize(),
  musicalTypingOpen:()=>musicalTypingOpen(),toggleMusicalTyping:()=>toggleMusicalTyping(),
  togglePluginWindows:()=>{const windows=[...document.querySelectorAll('dialog.logic-plugin-window')];if(!windows.length)return toast('No plug-in windows are open (V shows or hides them).');const hide=windows.some(item=>item.style.visibility!=='hidden');for(const item of windows)item.style.visibility=hide?'hidden':'';},
  help:shortcuts,diagnostics:connectionDiagnostics,docs:()=>window.open('https://freestyle.audio/docs/quickstart.html','_blank')
 }),
 TracksEdit:legacyMenuItems.Edit,
 Freestyle:()=>{
  const items=legacyMenuItems.Freestyle(),sub=label=>items.find(item=>item&&!Array.isArray(item)&&item.label===label)?.submenu;
  sub('Transport')?.unshift(['Record','R',()=>$('#record').click()],['Go to Beginning','↩',()=>playlistHome()],{label:'Go to End of Last Region',shortcut:'⌥↩',run:()=>logicKeyCommand('go-to-end')});
  sub('View')?.unshift({label:'Loop Browser',checked:!!logicShell?.state?.panes?.loops,run:()=>logicShell?.togglePane('loops'),title:'The Browser’s Loops list.'});
  const at=items.findIndex(item=>item&&!Array.isArray(item)&&item.label==='Edit');
  items.splice(at<0?items.length:at,0,{label:'File',submenu:[freestyleExtras.item('importUrl'),freestyleExtras.item('exportHistory')]});
  items.push(null,['Key Commands…','⌥K',()=>logicShell.openKeyCommands()],['Connection and Interaction Diagnostics','',connectionDiagnostics],['Freestyle Documentation ↗','',()=>window.open('https://freestyle.audio/docs/quickstart.html','_blank')]);
  return items;
 }
};
let mainMenuOpen=null;
function openMainMenu(name){const b=$(`#main-menu [data-menu="${name}"]`);if(!b)return;const r=b.getBoundingClientRect();menu({clientX:r.left,clientY:r.bottom+5},menuItems[name]());mainMenuOpen={name,node:$('#context-menu').firstElementChild};}
/** Re-render a main menu in place (e.g. File once its saved versions arrive) only while that same menu is still showing. */
function refreshMainMenu(name){const m=$('#context-menu');if(mainMenuOpen?.name===name&&!m.classList.contains('hidden')&&m.firstElementChild===mainMenuOpen.node)openMainMenu(name);}
/* Inside Freestyle Studio the View menu also switches between the Studio views (host.requestView). */
{const appView=menuItems.View;menuItems.View=()=>{const own=appView?.()||[];return embeddedInFreestyle()?[...own,...(own.length?[null]:[]),...STUDIO_VIEWS.map(([id,label])=>({label:`${label} View`,checked:activeStudioView()===id,run:()=>switchStudioView(id)}))]:own;};}
/* Logic's menu order; the Freestyle group sits before Help. */const MAIN_MENU_ORDER=['File','Edit','Track','Navigate','Record','Mix','View','Window','Freestyle','Help'];
$('#main-menu').innerHTML=MAIN_MENU_ORDER.map(name=>`<button data-menu="${name}">${name}</button>`).join('');
/* Menu bar tracking, as on macOS: one click opens a menu, then moving over the other titles switches menus without another click;
   clicking the open title closes it. The open title stays highlighted for as long as its menu is showing. */
function mainMenuShowing(){const m=$('#context-menu');return mainMenuOpen&&!m.classList.contains('hidden')&&m.firstElementChild===mainMenuOpen.node?mainMenuOpen.name:null;}
function syncMainMenuHighlight(){const open=mainMenuShowing();for(const b of $$('#main-menu [data-menu]')){const on=b.dataset.menu===open;b.classList.toggle('menu-open',on);b.setAttribute('aria-expanded',String(on));}}
new MutationObserver(syncMainMenuHighlight).observe($('#context-menu'),{attributes:true,attributeFilter:['class'],childList:true});
$$('#main-menu [data-menu]').forEach(b=>{b.setAttribute('aria-haspopup','menu');b.onclick=()=>{if(mainMenuShowing()===b.dataset.menu){$('#context-menu').classList.add('hidden');return;}openMainMenu(b.dataset.menu);};b.addEventListener('pointerenter',()=>{const open=mainMenuShowing();if(open&&open!==b.dataset.menu)openMainMenu(b.dataset.menu);});});
function deleteSelected(){if(activeEditor()==='playlist'&&!playlistSelection.ids.size&&selectedAutomationKey){const split=selectedAutomationKey.indexOf('|'),clipId=selectedAutomationKey.slice(0,split),targetKey=selectedAutomationKey.slice(split+1);return deleteAutomationClip(automationStore.find(clipId,targetKey));}if(activeEditor()==='piano'&&(selectedNotes.size||selectedNote)){edit(()=>{const notes=pattern().notes[channel().id]||[];pattern().notes[channel().id]=notes.filter(n=>!selectedNotes.has(n.id)&&n.id!==selectedNote);clearPianoSelection();});}else if(activeEditor()==='playlist'&&playlistSelection.ids.size){const selected=playlistSelection.ids;edit(()=>{project.clips=project.clips.filter(c=>!selected.has(c.id));project.audioClips=(project.audioClips||[]).filter(c=>!selected.has(c.id));playlistSelection.clear();selectedClip=null;});}}
$('#play').onclick=()=>togglePlay().catch(fail);$('#stop').onclick=stop;$('#stop').ondblclick=()=>{midiPanic();};$('#record').onclick=()=>toggleRecord().catch(fail);$('#mode').onclick=switchPlaybackMode;$('#tempo').onchange=e=>{/* spinner / wheel steps settle into ONE commit */if(Date.now()-tempoStep.armedAt<TEMPO_STEP_ARM_MS){scheduleTempoStep();return;}cancelTempoStep();commitTempo(+e.target.value);};$('#tempo').addEventListener('keydown',e=>{if((e.key==='ArrowUp'||e.key==='ArrowDown')&&!e.metaKey&&!e.ctrlKey&&!e.altKey){e.preventDefault();e.stopPropagation();stepTempo(e.key==='ArrowUp'?1:-1,e.shiftKey);}else if(e.key==='Enter'&&tempoStep.timer!==null){e.preventDefault();flushTempoStep();}});$('#tempo').addEventListener('pointerdown',e=>{const rect=e.currentTarget.getBoundingClientRect();if(e.button===0&&e.clientX>=rect.right-20)tempoStep.armedAt=Date.now();});$('#tempo').addEventListener('wheel',()=>{tempoStep.armedAt=Date.now();},{passive:true});$('#tempo').addEventListener('blur',flushTempoStep);function commitTempo(value){if(Number.isFinite(value)&&Number.isFinite(project.bpm)&&Math.abs(value-project.bpm)<.0005){renderSummary();return;}if(project.cloud?.rawProject?.timingMap?.isConstantTempo===false){renderSummary();return toast('Edit this project’s tempo map in Options → Tempo and time signatures.');}/* ADAPT: stretch_audio job (one undo step); KEEP: the unchanged keep_time edit */if(tempoAdaptBusy()){renderSummary();return toast(window.vegetableStudio.tempoAdapt.controller.blockMessage('changing the tempo again'));}/* KEEP on a Studio API project is also the controller's: ONE keep_time PUT at the fresh timing-map ETag (never the project ETag), one history step; a refusal leaves project.bpm, so renderSummary rolls the LCD back */if(window.vegetableStudio?.tempoAdapt?.handles?.()&&(workspaceBusy()||engine.applying||engine.interacting||engine.editBlocked)){renderSummary();return toast(`Wait for the cloud operation to finish before ${window.vegetableStudio.tempoAdapt.mode()==='adapt'?'adapting':'changing'} the tempo.`);}const adapting=window.vegetableStudio?.tempoAdapt?.commit(value);if(adapting){adapting.finally(()=>renderSummary());return;}return edit(()=>project.bpm=Math.round(Math.max(10,Math.min(522,value||128))*1000)/1000);}$('#metronome').onclick=toggleMetronomeUi;$('#pattern-select').onchange=e=>selectPattern(e.target.value);$('#add-pattern').onclick=addPattern;$('#new-picker-pattern').onclick=addPattern;$('#previous-pattern').onclick=()=>{const i=project.patterns.indexOf(pattern());selectPattern(project.patterns[(i+project.patterns.length-1)%project.patterns.length].id);};$('#undo').onclick=undo;$('#redo').onclick=redo;$('#save').onclick=()=>{const refused=!!engine.interacting;return saveProject().then(()=>{/* Trashlab: the Save pill and "Last Saved" follow a stored snapshot */if(engine.ready&&!refused){dirty=false;projectSnapshotAt=Date.now();}}).catch(fail);};$('#export').onclick=()=>exportWav().catch(fail);$('#help').onclick=shortcuts;$('#show-piano').onclick=()=>showWindow('piano');$('#cloud').onclick=()=>openCloudPanel().catch(fail);$('#open-cloud-footer').onclick=()=>openCloudPanel().catch(fail);$('#channel-filter').onchange=renderRack;$('#rack-fill').onclick=()=>fillRackChannel(channel().id,4);$('#add-channel').onclick=e=>menu(e,addMenuEntries({rack:true}));$('#browser-search').oninput=()=>{if(!cloudLibrary)renderBrowser();};$('#collapse-browser').onclick=()=>$('.browser').classList.toggle('collapsed');$$('[data-browser]').forEach(b=>b.onclick=()=>{browserTab=b.dataset.browser;$$('[data-browser]').forEach(x=>{x.classList.toggle('selected',x===b);if(x.getAttribute('role')==='tab')x.setAttribute('aria-selected',String(x===b));});if(cloudLibrary&&cloudLibrary.view!==cloudLibraryView)cloudLibraryView=null;renderBrowser();});
$$('button[data-tool]').forEach(b=>b.onclick=()=>{activeRackCancel?.();tool=b.dataset.tool;$('#playlist').dataset.playlistTool=tool;$$('button[data-tool]').forEach(x=>x.classList.toggle('selected',x===b));toast(`${tool[0].toUpperCase()+tool.slice(1)} tool selected`);renderPlaylist();});$('#piano-draw').onclick=()=>setPianoTool('draw');$('#piano-paint').onclick=()=>setPianoTool('paint');$('#piano-erase').onclick=()=>setPianoTool('erase');$('#piano-select').onclick=()=>setPianoTool('select');$('#piano-slice').onclick=()=>setPianoTool('slice');$('#piano-zoom').onclick=()=>setPianoTool('zoom');$('#piano-playback').onclick=()=>setPianoTool('playback');$('#piano-mute').onclick=()=>setPianoTool('mute');$('#piano-slide').onclick=()=>setPianoTool('slide');$('#piano-clear').onclick=()=>edit(()=>{pattern().notes[channel().id]=[];pattern().steps[channel().id]=Array(16).fill(false);});$('#piano-expand').onclick=togglePianoMaximize;$('#playlist-fit').onclick=()=>fitPlaylistView();/* QA round 19: the former one-click ↺ "Clear arrangement" is Edit ▸ Clear playlist… with a confirmation */$('#reset-mixer').onclick=resetChannelLevels;
for(const [id,factor]of [['playlist-zoom-out',.8],['playlist-zoom-in',1.25]])$('#'+id).onclick=()=>timelineViewport.zoomBy(factor);
/* Illogic: Logic plays computer-keyboard notes only while Musical Typing (⌘K) is open, so the inherited typing piano starts off and its toggle is hidden. */let typingEnabled=false;const typingToggle=$('#typing-keyboard');typingToggle.className='tool-square logic-legacy';typingToggle.setAttribute('aria-pressed','false');typingToggle.title='Typing keyboard to piano (legacy)';typingToggle.textContent='⌨';typingToggle.onclick=()=>{typingEnabled=!typingEnabled;if(!typingEnabled)typingAudition.releaseAll();typingToggle.classList.toggle('lit',typingEnabled);typingToggle.setAttribute('aria-pressed',String(typingEnabled));};
mountStudioIcons();
/** Logic: the keyboard (Musical Typing, on-screen keys, MIDI) plays the SELECTED track's software instrument;
 * with no instrument track selected it plays the editor's current channel (Step Sequencer row / Piano Roll). */
function noteInputChannel(){
 const row=selectedTrackRow(),laneId=row===null?null:project.cloud?.timelineLaneIds?.[row];
 const lane=laneId?project.channels.find(item=>!item.patternSource&&item.laneId===laneId&&(item.type==='instrument'||item.instrumentType)):null;
 return lane||channel();
}
/* MIDI take (Record on a software-instrument track): every played note is stamped with the song position. */
let midiTake=null;
const takeBeat=()=>{const clock=engine.positionAt?.();return clock?.playing&&Number.isFinite(Number(clock.beat))?Number(clock.beat):null;};
const typingAudition=new TypingPianoAudition({getChannel:noteInputChannel,onError:fail,startVoice:(current,pitch,velocity)=>{
 const take=midiTake;if(take&&current?.laneId===take.laneId){const beat=takeBeat();if(beat!==null){take.take.noteOn(pitch,velocity,beat);const voice=typingVoice(current,pitch,velocity),release=voice?.release?.bind(voice);if(!voice||!release)return voice;/* the voice is frozen: a delegating wrapper stamps the note-off */return Object.create(voice,{release:{value:(...args)=>{try{const end=takeBeat();if(midiTake===take&&end!==null)take.take.noteOff(pitch,end);}catch{}return release(...args);},enumerable:true}});}}
 return typingVoice(current,pitch,velocity);
}});
function typingVoice(current,pitch,velocity){
 if(current.type==='instrument'||current.instrumentType||current.cloudRaw?.kind==='plugin')return engine.acquireInstrumentNote(current,pitch,velocity);
 // Existing sample audition is a one-shot; its API has no owned stop action.
 return{ready:engine.noteOn(current,pitch),release(){}};
}
// FL: a hardware MIDI keyboard plays the selected Channel Rack channel.
midiInput=new WebMidiInput({getChannel:noteInputChannel,startVoice:(current,pitch,velocity)=>typingAudition.startVoice(current,pitch,velocity),onError:fail,onChange:state=>paintMidiKeys(state.pitches)});
// ---- Logic Editors pane (Piano Roll | Step Sequencer), Musical Typing (⌘K), Step Sequencer header ----
// var: showWindow() may run syncEditorPane() before this line during startup.
var editorPaneKind=$('#piano').classList.contains('hidden')?'step':'piano';
const EDITOR_WINDOW_IDS=LOGIC_EDITOR_TABS.map(tab=>tab.window).filter(id=>$('#'+id));
function editorPaneVisible(){return EDITOR_WINDOW_IDS.some(id=>!$('#'+id).classList.contains('hidden'));}
function renderEditorWindow(id){if(id==='rack')renderRack();else if(id==='piano')renderPiano();else if(id==='audio-editor')paintAudioEditor();}
/** Logic shows one editor tab at a time in the bottom pane: showing one hides the other. */
// The tab a just-shown editor replaced: hiding that editor with its window toggle returns to it
// (e.g. Step Sequencer → Piano Roll → toggle off → Step Sequencer); E / closeEditorPane closes the pane.
var editorPaneDisplaced=null;
function syncEditorPane(changedId){
 const win=changedId&&$('#'+changedId),others=changedId?EDITOR_WINDOW_IDS.filter(id=>id!==changedId).map(id=>$('#'+id)):[];
 if(win&&!win.classList.contains('hidden')){const shown=others.filter(other=>!other.classList.contains('hidden'));if(shown.length){for(const other of shown){other.classList.add('hidden');$$(`[data-window="${other.id}"]`).forEach(b=>b.classList.remove('lit'));}editorPaneDisplaced=shown[0].id;}else if(editorPaneDisplaced===changedId)editorPaneDisplaced=null;editorPaneKind=editorKindForWindow(changedId);document.dispatchEvent(new CustomEvent('illogic-editor-shown',{detail:{kind:editorPaneKind}}));}
 else if(win&&editorPaneDisplaced&&editorPaneDisplaced!==changedId&&EDITOR_WINDOW_IDS.includes(editorPaneDisplaced)){const other=$('#'+editorPaneDisplaced);editorPaneDisplaced=null;other.classList.remove('hidden');windows.raise(other);$$(`[data-window="${other.id}"]`).forEach(b=>b.classList.add('lit'));editorPaneKind=editorKindForWindow(other.id);renderEditorWindow(other.id);}
 // Logic: the Mixer (X) and the editors share the bottom pane; showing an editor closes the Mixer.
 if(editorPaneVisible())closeMixerDock();
 document.body.classList.toggle('editors-open',editorPaneVisible());document.body.dataset.editor=editorPaneVisible()?editorPaneKind:'';
 for(const tabs of $$('.logic-editor-tabs'))setMarkupIfChanged(tabs,editorTabsMarkup(editorPaneKind));
}
function openEditorPane(kind='piano'){const id=editorWindowId(kind);if(!id||!$('#'+id))return false;showWindow(id);if(id==='rack')renderRack();else if(id==='audio-editor')paintAudioEditor();return true;}
function closeEditorPane(){activePianoCancel?.();activeRackCancel?.();editorPaneDisplaced=null;for(const id of EDITOR_WINDOW_IDS){$('#'+id).classList.add('hidden');$$(`[data-window="${id}"]`).forEach(b=>b.classList.remove('lit'));}syncEditorPane(null);return true;}
function toggleEditorPane(){return editorPaneVisible()?closeEditorPane():openEditorPane(editorPaneKind);}
// The docked Mixer shares the bottom slot (X swaps): body.mixer-open hides the Editors and closing the
// Mixer brings back the editor it covered. Showing an editor announces itself so the Mixer can step aside.
var editorsCoveredByMixer=null,mixerWasOpen=document.body.classList.contains('mixer-open');
new MutationObserver(()=>{const mixer=document.body.classList.contains('mixer-open');if(mixer===mixerWasOpen)return;mixerWasOpen=mixer;// act on Mixer open/close transitions only
 if(mixer&&editorPaneVisible()){editorsCoveredByMixer=editorPaneKind;closeEditorPane();}
 else if(!mixer&&editorsCoveredByMixer){const kind=editorsCoveredByMixer;editorsCoveredByMixer=null;openEditorPane(kind);}
}).observe(document.body,{attributes:true,attributeFilter:['class']});
window.addEventListener('illogic-bottom-pane',e=>{if(e.detail?.owner!=='editors')editorsCoveredByMixer=null;});
document.addEventListener('illogic-editor-shown',()=>{editorsCoveredByMixer=null;if(document.body.classList.contains('mixer-open'))window.dispatchEvent(new CustomEvent('illogic-bottom-pane',{detail:{owner:'editors'}}));});
document.addEventListener('click',e=>{const tab=e.target.closest?.('[data-editor-tab]');if(tab){e.preventDefault();openEditorPane(tab.dataset.editorTab);}});
syncEditorPane(editorPaneVisible()?editorWindowId(editorPaneKind):null);
// Editors pane height: drag the top edge (Logic's divider). Persisted per browser only.
// v2 key: heights saved before the Logic ~40 % default are ignored.
{const root=document.documentElement,heightKey='illogic-editor-height-v2';let saved=0;try{saved=Number(localStorage.getItem(heightKey))||0;}catch{}
 const apply=height=>{const value=clampEditorHeight(height,{viewport:innerHeight||900});root.style.setProperty('--logic-editor-height',`${value}px`);return value;};apply(saved||defaultEditorHeight(innerHeight||900));
 for(const handle of $$('.logic-editor-resize'))handle.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();const pane=handle.closest('.logic-editor-pane'),startY=e.clientY,startHeight=pane?.getBoundingClientRect().height||EDITOR_HEIGHT.default;let last=startHeight;try{handle.setPointerCapture(e.pointerId);}catch{}
  const move=next=>{if(next.pointerId!==e.pointerId)return;last=apply(startHeight+(startY-next.clientY));},up=next=>{if(next.pointerId!==e.pointerId)return;handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',up);handle.removeEventListener('pointercancel',up);try{localStorage.setItem(heightKey,String(last));}catch{}pianoNavigator?.refresh();};
  handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',up);handle.addEventListener('pointercancel',up);});}
// Piano Roll header and local inspector.
$('#piano-tool-left').onclick=e=>pianoToolMenu(e,false);$('#piano-tool-command').onclick=e=>pianoToolMenu(e,true);syncPianoToolMenus();
for(const [id,kind]of [['piano-menu-edit','edit'],['piano-menu-functions','functions'],['piano-menu-view','view']])$('#'+id).onclick=e=>pianoLocalMenu(e,kind);
$('#piano-midi-in').onclick=()=>toggleMidiInput().finally(()=>{const on=midiInput?.state==='on';$('#piano-midi-in').classList.toggle('lit',on);$('#piano-midi-in').setAttribute('aria-pressed',String(on));});
$('#piano-midi-out').onclick=()=>{togglePianoPreviewNotes();$('#piano-midi-out').classList.toggle('lit',pianoPreviewNotes);$('#piano-midi-out').setAttribute('aria-pressed',String(pianoPreviewNotes));};
/* Logic's Show / Hide Automation button: the Piano Roll's lane under the grid is the note velocity (MIDI Draw) lane. */
if($('#piano-automation')){$('#piano-automation').onclick=()=>{const shown=$('#piano').classList.toggle('hide-velocity')===false;$('#piano-automation').classList.toggle('lit',shown);$('#piano-automation').setAttribute('aria-pressed',String(shown));if(shown)renderPiano();/* bars scale to the lane now laid out */};}
if($('#piano-collapse'))$('#piano-collapse').onclick=()=>setPianoCollapsed(!pianoCollapsed);
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
 if(browserTab==='patterns'&&!cloudLibrary)renderPatternsTab();// the Sounds panel's mini previews follow step edits
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
const musicalTypingAudition=new TypingPianoAudition({getChannel:noteInputChannel,onError:fail,startVoice:(current,pitch,velocity)=>typingAudition.startVoice(current,pitch,velocity),pitchFor:event=>musicalTyping.pitchFor(event),velocityFor:()=>musicalTyping.velocityFor(),keyFor:typingCode});
const musicalTypingOpen=()=>!$('#musical-typing').classList.contains('hidden');
function paintMusicalTyping(){const body=$('#musical-typing-body');if(body&&musicalTypingOpen())body.innerHTML=musicalTypingMarkup(musicalTyping,new Set(musicalTypingAudition.held.keys()));}
function toggleMusicalTyping(force){const win=$('#musical-typing'),open=typeof force==='boolean'?force:!musicalTypingOpen();win.classList.toggle('hidden',!open);if(!open)musicalTypingAudition.releaseAll();paintMusicalTyping();return open;}
$('#musical-typing-close').onclick=()=>toggleMusicalTyping(false);
$('#musical-typing-body').addEventListener('pointerdown',e=>{const key=e.target.closest?.('.mt-key');if(!key||e.button!==0)return;e.preventDefault();let voice=null;try{voice=typingAudition.startVoice(noteInputChannel(),Number(key.dataset.pitch),musicalTyping.velocityFor());}catch(error){fail(error);return;}key.classList.add('down');const release=()=>{key.classList.remove('down');try{voice?.release?.();}catch(error){fail(error);}window.removeEventListener('pointerup',release);window.removeEventListener('pointercancel',release);};window.addEventListener('pointerup',release);window.addEventListener('pointercancel',release);Promise.resolve(voice?.ready).catch(fail);});
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
window.illogic=Object.assign(window.illogic||{},{createPatternRegionAt});
registerEditorsApi({open:openEditorPane,toggle:toggleEditorPane,close:closeEditorPane,toggleMusicalTyping:()=>toggleMusicalTyping(),quantize:quantizePianoSelection,setTool:tool=>{if(activeEditor()==='rack')return false;/* Logic's Tool menu id 'solo' is the Piano Roll's Solo (audition/scrub) tool */const id=tool==='solo'?'playback':tool==='brush'?'paint':tool;if(!logicPianoTool(id)||logicPianoTool(id).unsupported)return false;setPianoTool(id);return true;},active:()=>editorPaneVisible()?editorPaneKind:null});
function midiInputLabel(){const state=midiInput?.state;return state==='on'?`On${midiInput.inputs.size?` · ${midiInput.inputNames().join(', ')}`:' · no device'}`:state==='requesting'?'Requesting…':state==='denied'?'Blocked':state==='unsupported'?'Unsupported':state==='error'?'Error':'Off';}
function toggleMidiInput(){return midiInput.toggle().then(state=>toast(state==='on'?`MIDI keyboard input on${midiInput.inputs.size?`: ${midiInput.inputNames().join(', ')}`:' (connect a device)'}`:state==='off'?'MIDI keyboard input off':midiInput.error||`MIDI keyboard input ${state}`));}
{let wire=engine.monitor.generation;const reset=()=>{if(engine.monitor.generation!==wire){wire=engine.monitor.generation;midiInput.releaseAll();}};for(const type of ['state','connected'])engine.monitor.addEventListener?.(type,reset);}
const coreShortcutHandlers={
 // Illogic: FL's F5/F6/F7/F9 window keys are not Logic keys (X Mixer, E Editors, P Piano Roll live in logic-keys.js).
 // Illogic: FL's F2 (rename) and F4 (next empty pattern) are not Logic keys. Rename lives in Track ▸ Rename Track
 // and the Pattern Browser; New Pattern in the Pattern Browser.
 'playlist-home':playlistHome,
 // Illogic: FL's ⇧Q, PgUp/PgDn zoom, ⇧⌫ snap, ⌘T typing, ⌘M metronome / MIDI import, letter tool keys, ⌘D deselect and ⌘B duplicate are not
 // Logic key commands; the default key command table (logic-key-commands.js) owns those keys.
 'transport-start-stop':()=>togglePlay({stopInsteadOfPause:true}).catch(fail),
 'transport-start-pause':()=>togglePlay().catch(fail),undo:()=>undo(),redo:()=>redo(),
 save:()=>saveProject().catch(fail),'save-as':()=>Promise.resolve().then(()=>openRangeSafeSaveAs({engine,getProject:()=>project,dialog,openLibrary:()=>openCloudPanel(),onStatus:toast})).catch(fail),open:()=>openCloudPanel().catch(fail),
 'delete-selection':action=>action.editor==='rack'?rackClipboardAction('delete'):deleteSelected(),
 copy:action=>action.editor==='playlist'?playlistClipboardAction('copy'):action.editor==='piano'?copyPianoNotes():rackClipboardAction('copy'),
 cut:action=>action.editor==='playlist'?playlistClipboardAction('cut'):action.editor==='piano'?cutPianoNotes():rackClipboardAction('cut'),
 paste:action=>action.editor==='playlist'?playlistClipboardAction('paste'):action.editor==='piano'?pastePianoNotes():rackClipboardAction('paste')
};
document.addEventListener('keydown',e=>{if(playlistKeyboard.keyDown(e))return;if(studioShortcutBlocked(e,{dialogOpen:shortcutDialogOpen(e)}))return;if(handleStudioShortcut(e,{editor:activeEditor(),typingEnabled,dialogOpen:false,availableTools:{playlist:['draw','paint','erase','slice','select','slip','mute','zoom','playback']}},coreShortcutHandlers))return;if(e.defaultPrevented||e.target.closest('input,select,textarea,[contenteditable=true]')||shortcutDialogOpen(e))return;const meta=e.metaKey||e.ctrlKey,rackCommand=rackClipboardCommand(e,{rackFocused:activeEditor()==='rack',dialogOpen:shortcutDialogOpen(e)});if(rackCommand){e.preventDefault();rackClipboardAction(rackCommand);return;}const rackRotate=rackRotateCommand(e,{rackFocused:activeEditor()==='rack',dialogOpen:shortcutDialogOpen(e)});if(rackRotate){e.preventDefault();rotateRackChannels(rackStepChannelIds(rackStepChannelIds(null).length?null:channel().id),rackRotate);return;}if(meta&&e.key.toLowerCase()==='a'&&activeEditor()==='rack'){e.preventDefault();rackSelector.selectAll();return;}if(meta&&e.key.toLowerCase()==='k'&&activeEditor()==='rack'){e.preventDefault();if(!e.repeat)toggleRackGraph();return;}if(meta&&e.key.toLowerCase()==='a'&&activeEditor()==='playlist'){e.preventDefault();activePlaylistCancel?.();playlistSelection.select(allClips().map(c=>c.id));selectedClip=playlistSelection.ids.values().next().value||null;paintPlaylistSelection();return;}if(activeEditor()==='piano'){if(isPianoGhostToggle(e)){e.preventDefault();togglePianoGhosts();return;}if(!meta&&!e.altKey&&!e.shiftKey&&e.key.toLowerCase()==='q'){/* Logic Q: Time Quantize the selection */e.preventDefault();if(!e.repeat)quantizePianoSelection();return;}if(meta&&e.key.toLowerCase()==='a'){e.preventDefault();clearPianoSelection();(pattern().notes[channel().id]||[]).forEach(n=>selectedNotes.add(n.id));renderPiano();return;}if(meta&&e.key.toLowerCase()==='x'){e.preventDefault();if(!e.repeat)cutPianoNotes();return;}if(meta&&e.key.toLowerCase()==='c'){e.preventDefault();copyPianoNotes();return;}if(meta&&e.key.toLowerCase()==='v'){e.preventDefault();pastePianoNotes();return;}if(e.altKey&&e.key.toLowerCase()==='q'){e.preventDefault();quantizePianoDialog();return;}if((selectedNotes.size||e.shiftKey||meta&&['ArrowUp','ArrowDown'].includes(e.key))&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();/* Logic: ← / → select the previous / next note; ⌥← / ⌥→ nudge, ⌥↑ / ⌥↓ transpose a semitone, ⇧⌥↑ / ⇧⌥↓ an octave */if(!e.altKey&&!e.shiftKey&&!meta&&(e.key==='ArrowLeft'||e.key==='ArrowRight')){const all=[...(pattern().notes[channel().id]||[])].sort((a,b)=>a.start-b.start||a.pitch-b.pitch);if(all.length){const first=all.findIndex(note=>selectedNotes.has(note.id)),last=all.reduce((found,note,index)=>selectedNotes.has(note.id)?index:found,-1),next=e.key==='ArrowRight'?Math.min(all.length-1,last+1):Math.max(0,(first<0?all.length:first)-1);clearPianoSelection();selectedNotes.add(all[next].id);selectedNote=all[next].id;renderPiano();}return;}engine.interacting=true;const octave=meta||e.shiftKey&&e.altKey,/* ⌥← / ⌥→ nudge by the Piano Roll snap value (Logic's nudge value); ⌃⌥ nudges by the finest step */step=e.altKey&&e.ctrlKey?pianoMinimumNote(pattern()):(pianoSnap()||pianoMinimumNote(pattern())),deltaStart=e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0,deltaPitch=e.key==='ArrowUp'?(octave?12:1):e.key==='ArrowDown'?(octave?-12:-1):0;transformPianoNotes(notes=>movePianoGesture(notes,{deltaBeats:deltaStart,deltaPitch,snapBeats:0}));return;}}if(meta&&e.key.toLowerCase()==='s'){e.preventDefault();if(e.shiftKey)Promise.resolve().then(()=>openRangeSafeSaveAs({engine,getProject:()=>project,dialog,openLibrary:()=>openCloudPanel(),onStatus:toast})).catch(fail);else saveProject().catch(fail);return;}if(meta&&e.key.toLowerCase()==='o'){e.preventDefault();openCloudPanel().catch(fail);return;}if(meta&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();return;}if(e.key==='Delete'&&!meta&&!e.altKey&&!e.shiftKey){e.preventDefault();if(!e.repeat)deleteSelected();return;}if(e.key==='Escape'){if(activePlaylistCancel){activePlaylistCancel();return;}$('#context-menu').classList.add('hidden');playlistSelection.clear();selectedClip=null;paintPlaylistSelection();return;}if(meta||e.altKey)return;if(typingEnabled&&typingAudition.keyDown(e))e.preventDefault();});
// FL: show the resize cursor over each clip's ~8 px edge zones.
{let hovered=null;const clear=()=>{hovered?.removeAttribute('data-trim-edge');hovered=null;};$('#track-lanes').addEventListener('pointermove',event=>{if(event.buttons)return;const el=event.target?.closest?.('.clip[data-clip]'),edge=el&&!PLAYLIST_NO_TRIM_TOOLS.has(tool)?clipEdgeAt(event,el):null;if(hovered&&hovered!==el)clear();if(!el||!edge){el?.removeAttribute('data-trim-edge');if(hovered===el)hovered=null;return;}if(el.dataset.trimEdge!==edge)el.dataset.trimEdge=edge;hovered=el;});$('#track-lanes').addEventListener('pointerleave',clear);}
// FL: every Playlist drag source shares one hotspot (drag image left edge at the pointer), so the start cell is the cell under the pointer.
installPlaylistDragHotspot(document,{mimes:['application/vegetable-pattern',LIBRARY_SOUND_MIME],describe:(element,mime)=>element?.closest?.('[data-tl-pattern]')?'sounds-pattern':element?.closest?.('#pattern-picker')?'pattern-picker':element?.closest?.('[data-library^="pattern:"]')?'browser-pattern':element?.closest?.('#rack')?'rack-channel':mime===LIBRARY_SOUND_MIME?'browser-sample':'other'});
// FL: Space stays transport even after a toolbar button (PAT/SONG, windows, tools) was clicked.
installTransportKeyGuard(document);
document.addEventListener('mouseover',e=>{const el=e.target.closest('[title]');if(el)$('#hint').textContent=el.title;});
window.addEventListener('vegetable-cloud-status',e=>{$('#cloud-led').classList.toggle('connected',!!e.detail.connected);});
// FL meter ballistics (instant attack, dB-rate release, peak hold): a frame loop runs
// while any meter is above zero; stopped transport releases every meter to zero.
let meterFrame=null,meterStaleTimer=null,meterBallisticsScope=null,meterWasLive=false,meterStoppedAt=-Infinity;/* frames that predate a transport stop no longer drive the meters */const meterBallistics=new MeterBallistics();function mixerMeterReading(row,model=currentMixerModel()){return readMixerStripMeter(row,{projectId:model.projectId,frame:engine.currentMeterFrame()});}function mixerMeterDisplay(row,model=currentMixerModel(),now=Date.now()){const scope=`${model.projectId}|${engine.monitor?.generation??0}`;if(scope!==meterBallisticsScope){meterBallisticsScope=scope;meterBallistics.reset();}const live=!!(engine.playing||engine.previewing);if(meterWasLive&&!live)meterStoppedAt=now;meterWasLive=live;const reading=mixerMeterReading(row,model),fresh=reading.known&&(live||reading.receivedAt>meterStoppedAt),motion=meterBallistics.step(row.key,fresh?reading.value:0,now,{playing:live||fresh});return{...reading,level:motion.level,peak:motion.peak,active:motion.active};}function animate(){if(meterFrame!==null||document.documentElement.dataset.illogicActive==='false')return;meterFrame=requestAnimationFrame(()=>{meterFrame=null;clearTimeout(meterStaleTimer);meterStaleTimer=null;if(windows.dragging){meterStaleTimer=setTimeout(animate,100);return;}const model=currentMixerModel(),now=Date.now(),meterShown=new Map();let active=false,expires=null;for(const strip of $$('.mixer-strip[data-mixer-row],.logic-inspector-strip[data-mixer-row]')){const row=model.rows.find(row=>row.key===strip.dataset.mixerRow),meter=strip.querySelector('.meter'),fill=strip.querySelector('.meter-fill');if(!row||!meter||!fill)continue;/* one ballistics step per row per frame: the Mixer and the Inspector strip share it */const display=meterShown.get(row.key)||mixerMeterDisplay(row,model,now);meterShown.set(row.key,display);paintMixerMeter(meter,fill,row,display);if(row.kind==='bus'&&row.id==='master'){/* FL's big "C" peak column mirrors the master reading (one ballistics step) */const peak=$('#mixer-strips .mixer-peak');if(peak)paintMixerMeter(peak.querySelector('.meter'),peak.querySelector('.meter-fill'),row,display);}if(display.active)active=true;if(display.known)expires=Math.min(expires??Infinity,display.receivedAt+MIXER_METER_MAX_AGE_MS);}if(active)animate();else if(expires!==null)meterStaleTimer=setTimeout(animate,Math.max(0,expires-now)+20);});}
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
engine.onProjectLoaded=()=>{syncMixRevision();/* an already record-enabled track re-opens its uplink only when the microphone is already permitted (never a prompt at load) */try{navigator.permissions?.query?.({name:'microphone'}).then(status=>{if(status?.state==='granted')setTimeout(syncRecordingPrewarm,1500);},()=>{});}catch{}};engine.monitor.addEventListener('connected',()=>syncMixRevision());window.addEventListener('online',()=>syncMixRevision());
engine.onEditSettled=()=>{renderMixer();if(!engine.interacting)renderRack();requestMixerInspection();queueCloudWaveforms();};
engine.onMetronome=renderMetronome;engine.onError=fail;
// QA round 18: every refused save (rack steps, fills, rotate, paste, Piano notes…)
// has already been rolled back to the saved project; say so, whoever flushed it.
engine.onEditRejected=error=>{clientLog('edit-rejected',{code:error?.code??null,status:error?.status??null,error:String(error?.message||error).slice(0,200)});const message=error?.message||String(error);fail(Object.assign(error,{message:/^Not saved/.test(message)?message:`Not saved — the edit was rolled back. ${message}`}));error.rollbackShown=true;try{renderAll();}catch{}};engine.monitor.addEventListener('warning',e=>toast(e.detail.message));engine.monitor.addEventListener('connected',e=>{if(e.detail.projectId===engine.projectId&&e.detail.trackId){engine.session.trackId=e.detail.trackId;engine.refresh().catch(fail);}});engine.monitor.addEventListener('state',e=>{$('#session-status').textContent=e.detail.state==='connected'?'CLOUD AUDIO LIVE':e.detail.state==='error'?'CLOUD AUDIO BLOCKED':'CLOUD ENGINE';});engine.onPatternHistory=()=>{try{historyJournalObserved();}catch{}paintHistoryFeedback();};/* Logic: Undo is global. A pattern step on another pattern selects it and shows it in its editor first. */engine.patternHistory.onSelectPattern=id=>{if(!project.patterns.some(p=>p.id===id))return;selectPattern(id);openEditorPane(editorForPattern(pattern()));};engine.onStatus=message=>{queueRackControlSync();renderHistoryControls();if(playClockRead||$('#play').classList.contains('starting'))paintTransportBusy();const visible=filePickerFeedbackMessage(playClockReadFeedback(message));$('#status-message').textContent=visible;
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
 return{zone:'playlist',accepted:true,track,laneId:(entries.length?strictAudioLane:audioLane)?.id||null,audioLaneId:strictAudioLane?.id||null,beat,message:`Playlist · ${playlistDropLaneLabel(entries.length?strictAudioLane:audioLane,track)} · bar ${Math.floor(beat/4)+1}, beat ${Number((beat%4+1).toFixed(6))}${!event.altKey&&Number($('#snap').value)>0?' (snapped)':''}`};
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
function focusCreatedLane(id){if(!id)return;selectedMixerKey=mixerRowKey('lane',id);mixerChannel=id;renderMixer();const index=project.cloud?.timelineLaneIds?.indexOf(id);if(index>=0){$('#track-lanes').children[index]?.scrollIntoView?.({block:'nearest'});/* Logic: a new track is the selected track (header highlight, Inspector strips, Library target) */try{logicShell?.selectTrack(index);}catch(error){clientLog('logic-new-track-select-error',{message:String(error?.message||error).slice(0,160)});}}}
laneCreate=new CloudLaneCreate({engine,onChange:()=>{mixerView?.render();laneCreateDialog?.render();}});
const emptyInstrument=new CloudEmptyInstrument({engine,onChange:()=>{mixerView?.render();laneCreateDialog?.render();}});
laneCreateDialog=new CloudLaneCreateDialog({controller:laneCreate,onLaneCreate:options=>withPendingTrack({name:options?.name||'Audio',kind:'audio'},()=>createLaneWithHistory(options)),getScope:fileImportScope,isEditable:()=>directLevelEditable()&&!engine.interacting,onStatus:toast,getInstrumentAvailability:()=>uiFeature('create_instrument'),loadInstrumentOptions:()=>emptyInstrument.catalog(),onInstrument:args=>{requireUiFeature('create_instrument');return withPendingTrack({name:args?.name||args?.instrumentName||'Instrument',kind:'instrument'},()=>createLaneWithHistory(args,{instrument:true}));},onInstrumentInspect:()=>emptyInstrument.inspect(),onCreated:async receipt=>{await engine.refresh();if(receipt.kind==='instrument'){const lane=(project.cloud?.rawProject?.lanes||[]).find(lane=>lane.id===receipt.receipt.laneId&&lane.kind==='instrument');if(!lane||!receipt.receipt.emptyConfirmed)throw new Error('Inspect the saved tracks to confirm the empty instrument lane.');focusCreatedLane(lane.id);}else focusCreatedLane(receipt.lane?.id);},onInspected:async()=>{await engine.refresh();renderAll();},onSettled:()=>engine.onEditSettled()});
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
Object.assign(window.vegetableStudio,{get laneSends(){return laneSends;},rackSampleUpload,samplePlacement,patternLengthDialog:id=>patternLengthDialog(project.patterns.find(row=>row.id===id||row.cloudId===id))});

// ── Trashlab shell (logic-shell.js / logic-keys.js / logic-context-menu.js) ──
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

// ── Illogic: default key commands that need application state (logic-key-commands.js rows route here by name).
const logicNudge={value:'division'};
const logicNudgeBeats=()=>({tick:1/240,division:.25,beat:1,bar:4})[logicNudge.value]||.25;
const logicZoomSlots=new Map(),logicNavigation={stack:[],index:-1};
function logicSelectedRegions(){const ids=playlistSelection.ids;return allClips().filter(clip=>ids.has(clip.id)).sort((a,b)=>a.start-b.start||a.track-b.track);}
function logicSelectRegions(clips){playlistSelection.select(clips.map(clip=>clip.id));selectedClip=playlistSelection.ids.values().next().value||null;paintPlaylistSelection();}
function logicCycleArea(){const clock=engine.positionAt?.()||{},bpm=Number(clock.bpm)||Number(project.bpm)||120,start=Number(clock.loopStartSec)*bpm/60,end=Number(clock.loopEndSec)*bpm/60;if(end>start)return{startBeat:start,endBeat:end,enabled:!!clock.loopEnabled};return null;/* #17: Freestyle keeps the area while Cycle is off */}
function logicPianoNotes(){return pattern().notes?.[channel().id]||[];}
function logicSelectNotes(notes){clearPianoSelection();for(const note of notes)selectedNotes.add(note.id);selectedNote=notes[0]?.id||null;renderPiano();}
function logicRegionEdit(label,change){const regions=logicSelectedRegions();if(!regions.length)return toast(`${label}: select one or more regions first.`);if(!playlistEditable())return toast('Wait for the current cloud operation to finish.');const ids=new Set(regions.map(clip=>clip.id));return edit(()=>{for(const clip of [...(project.clips||[]),...(project.audioClips||[])])if(ids.has(clip.id))change(clip);});}
/** A score, viewport or window gesture in progress owns the view: key zoom waits. */
function logicZoomBusy(){return !!(engine.interacting||windows.dragging||windows.pending||windows.active||activePlaylistCancel||activePianoCancel||activeRackCancel||timelineViewport.pan||pianoViewport.pan);}
function logicKeyCommand(name,args=[]){
 const arg=args[0],number=Number(arg),scope=activeEditor(),inPiano=scope==='piano',need=label=>toast(`${label}: select one or more ${inPiano?'notes':'regions'} first.`);
 switch(name){
  case 'play':if(!engine.playing)return togglePlay().catch(fail);return;
  case 'pause':if(engine.playing)return togglePlay().catch(fail);return;
  case 'stop':return stop();
  case 'go-to-end':{const end=Math.max(0,...allClips().map(clip=>clip.start+clip.length));return playlistCursorJump(end);}
  case 'go-to-selection':{const regions=logicSelectedRegions();if(!regions.length)return need('Go to Selection');return playlistCursorJump(arg==='end'?Math.max(...regions.map(clip=>clip.start+clip.length)):regions[0].start);}
  case 'go-to-locator':{const area=logicCycleArea();if(!area)return toast('Go to Locator: set a cycle area first (C, or drag in the ruler).');return playlistCursorJump(arg==='right'?area.endBeat:area.startBeat);}
  case 'play-from-left-edge':{const beat=Math.max(0,$('#arrangement-scroll').scrollLeft/barWidth*4);playlistCursorJump(quantize(beat));if(!engine.playing)return togglePlay().catch(fail);return;}
  case 'move-locators':case 'scale-locators':{const area=logicCycleArea();if(!area)return toast('Set a cycle area first (C, or drag in the ruler).');const length=area.endBeat-area.startBeat,next=name==='move-locators'?{startBeat:Math.max(0,area.startBeat+number*length),endBeat:Math.max(0,area.startBeat+number*length)+length}:{startBeat:area.startBeat,endBeat:area.startBeat+Math.max(.25,length*number)};return playlistLoop.apply({enabled:true,...next}).catch(fail);}
  case 'zoom-to-locators':{const area=logicCycleArea();if(!area)return toast('Zoom to fit Locators: set a cycle area first.');logicKeyCommand('nav-store');const viewport=$('#arrangement-scroll'),width=Math.max(200,viewport.clientWidth-PLAYLIST_GUTTER-40),scale=Math.max(timelineViewport.min,Math.min(timelineViewport.max,width/((area.endBeat-area.startBeat)/4)));return applyPlaylistView({...playlistView(),scale,scrollLeft:Math.max(0,area.startBeat/4*scale-20)});}
  case 'nav-store':{logicNavigation.stack=logicNavigation.stack.slice(0,logicNavigation.index+1);logicNavigation.stack.push(playlistView());logicNavigation.index=logicNavigation.stack.length-1;if(!args.silent)toast(`Navigation snapshot ${logicNavigation.stack.length} stored (⌥Z back, ⌥⇧Z forward).`);return;}
  case 'nav-step':{const stack=logicNavigation.stack;if(!stack.length)return toast('No navigation snapshot yet: ⇧Z stores one.');if(number<0&&logicNavigation.index===stack.length-1&&JSON.stringify(stack[logicNavigation.index])!==JSON.stringify(playlistView())){stack.push(playlistView());}else logicNavigation.index=Math.max(0,Math.min(stack.length-1,logicNavigation.index+number));return applyPlaylistView(stack[logicNavigation.index]);}
  case 'zoom-save':logicZoomSlots.set(arg,playlistView());return toast(`Zoom ${arg} saved.`);
  case 'zoom-recall':{const view=logicZoomSlots.get(arg);if(!view)return toast(`Zoom ${arg} is empty: ⌃⌥⇧⌘${arg} saves the current zoom.`);return applyPlaylistView({...playlistView(),scale:view.scale,rowHeight:view.rowHeight});}
  case 'page':{const viewport=inPiano?$('#piano-scroll'):$('#arrangement-scroll');if(!viewport)return;const dx={left:-1,right:1}[arg]||0,dy={up:-1,down:1}[arg]||0;viewport.scrollBy({left:dx*viewport.clientWidth*.9,top:dy*viewport.clientHeight*.9});return;}
  case 'scroll-to-selection':{if(inPiano){const el=$('#piano .piano-note.selected');if(!el)return need('Scroll to Selection');return el.scrollIntoView({block:'center',inline:'center'});}const regions=logicSelectedRegions();if(!regions.length)return need('Scroll to Selection');const viewport=$('#arrangement-scroll');viewport.scrollLeft=Math.max(0,regions[0].start/4*barWidth-viewport.clientWidth/3);$(`#playlist .clip[data-clip="${CSS.escape(String(regions[0].id))}"]`)?.scrollIntoView({block:'nearest',inline:'nearest'});return;}
  case 'toggle-catch':logicCatch=!logicCatch;try{localStorage.setItem('illogic:catch',String(logicCatch));}catch{}return toast(`Catch Playhead ${logicCatch?'on':'off'}`);
  case 'toggle-audio-editor':return editorPaneVisible()&&editorPaneKind==='audio'?closeEditorPane():openEditorPane('audio');
  case 'open-audio-editor':return openEditorPane('audio');
  case 'open-piano':return openEditorPane('piano');
  case 'open-step':return openEditorPane('step');
  case 'open-mixer':return toggleMixer(true);
  case 'show-tracks':closeEditorPane();toggleMixer(false);return $('#playlist')?.focus();
  case 'cycle-views':{const order=['playlist',...(editorPaneVisible()?[editorWindowId(editorPaneKind)]:[]),...($('#mixer').classList.contains('hidden')?[]:['mixer'])],at=Math.max(0,order.indexOf(activeEditor()||'playlist')),next=order[(at+number+order.length)%order.length],win=$('#'+next);if(!win)return;windows.raise(win);win.focus?.({preventScroll:true});return toast(`${({playlist:'Tracks area',piano:'Piano Roll',rack:'Step Sequencer',mixer:'Mixer','audio-editor':'Audio Track Editor'})[next]||next} has key focus.`);}
  case 'toggle-local-inspector':$('#piano').classList.toggle('hide-inspector');return;
  case 'full-screen':return document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen?.().catch(()=>toast('The browser refused full screen.'));
  case 'new-project':return newProjectDialog();
  case 'project-settings':return projectInfo();
  case 'export-selection-midi':return exportSelectionMidi();
  case 'midi-transform':if(!inPiano)return toast('MIDI Transform: open the Piano Roll (P) and select notes first.');return window.illogic.openHumanize();
  case 'waveform-zoom':{const next=Math.max(1,Math.min(8,(Number(document.documentElement.style.getPropertyValue('--wave-zoom'))||1)*(number>0?1.25:.8)));document.documentElement.style.setProperty('--wave-zoom',String(next));window.illogic.waveZoom=next;renderPlaylist();return toast(`Waveform zoom ×${next.toFixed(2)}`);}
  case 'toggle-snap':return toggleSnap();
  // Piano Roll ⌥← / ⌥→ (nudge by the snap value) and ⌥↑ / ⌥↓ / ⌥⇧↑ / ⌥⇧↓ (transpose). Routed here because Option
  // reports AltGraph in the browser on macOS, which the older shortcut layer leaves alone.
  case 'nudge-notes':case 'transpose-notes':{if(!inPiano)return;if(!selectedNotes.size)return need(name==='nudge-notes'?'Nudge':'Transpose');engine.interacting=true;const step=pianoSnap()||pianoMinimumNote(pattern());return transformPianoNotes(notes=>movePianoGesture(notes,name==='nudge-notes'?{deltaBeats:number*step,deltaPitch:0,snapBeats:0}:{deltaBeats:0,deltaPitch:number,snapBeats:0}));}
  case 'nudge-value':logicNudge.value=arg;return toast(`Nudge value: ${({tick:'Tick',division:'Division (1/16)',beat:'Beat',bar:'Bar'})[arg]}`);
  case 'nudge':return logicRegionEdit('Nudge',clip=>{clip.start=Math.max(0,clip.start+number*logicNudgeBeats());});
  case 'nudge-length':{const regions=logicSelectedRegions();if(regions.some(clip=>!clip.patternId))return toast('Nudge Length: audio regions are resized by dragging their edges (Freestyle trims audio there).');return logicRegionEdit('Nudge Length',clip=>{clip.length=Math.max(.25,clip.length+number*logicNudgeBeats());});}
  case 'move-to-playhead':{const regions=logicSelectedRegions();if(!regions.length)return need('Move to Playhead');const delta=playheadBeatNow()-regions[0].start;return logicRegionEdit('Move to Playhead',clip=>{clip.start=Math.max(0,clip.start+delta);});}
  case 'trim-to-playhead':{const regions=logicSelectedRegions(),beat=playheadBeatNow();if(!regions.length)return need('Set Region Start / End to Playhead');if(regions.some(clip=>!clip.patternId))return toast('Audio regions are trimmed by dragging their edges (Freestyle trims audio there).');if(regions.some(clip=>arg==='start'?beat>=clip.start+clip.length:beat<=clip.start))return toast('Place the playhead so the region keeps a length.');return logicRegionEdit('Trim',clip=>{if(arg==='end')clip.length=beat-clip.start;else{clip.length=clip.start+clip.length-beat;clip.start=beat;}});}
  case 'transpose-regions':return toast('Transpose: Freestyle regions carry no transpose value. Open the region in the Piano Roll (P) and press ⌥↑ / ⌥↓ there.');
  case 'remove-overlaps':case 'trim-end-to-next':{const regions=logicSelectedRegions();if(!regions.length)return need(name==='remove-overlaps'?'Remove Overlaps':'Trim Region End to Next Region');const next=clip=>allClips().filter(other=>other.track===clip.track&&other.start>clip.start).sort((a,b)=>a.start-b.start)[0],targets=regions.filter(clip=>{const follower=next(clip);return clip.patternId&&follower&&(name==='trim-end-to-next'?follower.start!==clip.start+clip.length:follower.start<clip.start+clip.length);});if(!targets.length)return toast(regions.some(clip=>!clip.patternId)?'Audio regions are trimmed by dragging their edges.':'Nothing to trim: no following region overlaps.');const ids=new Set(targets.map(clip=>clip.id));return edit(()=>{for(const clip of project.clips||[])if(ids.has(clip.id))clip.length=Math.max(.25,next(clip).start-clip.start);});}
  case 'crop-to-locators':case 'split-at-locators':{const area=logicCycleArea(),regions=logicSelectedRegions();if(!area)return toast('Set a cycle area first (C, or drag in the ruler).');if(!regions.length)return need(name==='crop-to-locators'?'Crop':'Split at Locators');if(name==='split-at-locators'){const cuts=[area.startBeat,area.endBeat];return(async()=>{for(const cut of cuts)for(const clip of logicSelectedRegions()){const current=findClip(clip.id);if(current&&cut>current.start+1e-6&&cut<current.start+current.length-1e-6)await(current.patternId?slicePatternPlacement(current,cut):sliceAudioClip(current,cut));}})().catch(fail);}if(regions.some(clip=>!clip.patternId))return toast('Crop: audio regions are trimmed by dragging their edges (Freestyle trims audio there).');return logicRegionEdit('Crop',clip=>{const start=Math.max(clip.start,area.startBeat),end=Math.min(clip.start+clip.length,area.endBeat);if(end-start>=.25){clip.start=start;clip.length=end-start;}});}
  case 'move-to-selected-track':{const row=selectedTrackRow(),regions=logicSelectedRegions();if(row===null)return toast('Move Selected Regions to Focused Track: select a track first.');if(!regions.length)return need('Move Selected Regions to Focused Track');const kind=clip=>clip.patternId?'pattern':'audio',laneKind=(project.cloud?.rawProject?.lanes||[]).find(lane=>lane.id===project.cloud.timelineLaneIds[row])?.kind;if(regions.some(clip=>(kind(clip)==='audio')!==(laneKind==='audio')))return toast('Audio regions go on audio tracks and MIDI / pattern regions on software instrument tracks.');return logicRegionEdit('Move to Track',clip=>{clip.track=row;});}
  case 'solo-selected-regions':{const rows=[...new Set(logicSelectedRegions().map(clip=>clip.track))];if(!rows.length)return need('Solo');return rows.forEach(row=>togglePlaylistTrackSolo(row));}
  case 'make-unique':{const regions=logicSelectedRegions().filter(clip=>clip.patternId);if(!regions.length)return toast('Convert to New Regions: select MIDI or pattern regions (audio regions are already independent).');/* one region after the other: each conversion is its own Undo step */return (async()=>{for(const clip of regions)await makeUnique(clip.id);})().catch(fail);}
  case 'rename-region':{const region=logicSelectedRegions()[0];if(!region)return need('Rename Regions');return renameRegion(region);}
  case 'name-regions-by-track':case 'name-track-by-region':return toast(`${name==='name-regions-by-track'?'Name Regions by Track Name':'Name Tracks by Region Name'}: rename the ${name==='name-regions-by-track'?'region (⇧N)':'track (⇧Return)'}; batch naming is not available.`);
  case 'rename-track':return renameSelectedTrack();
  case 'duplicate-track-content':return withSelectedTrack('New Track with Duplicate Settings and Content',duplicateFullPlaylistTrack);
  case 'delete-unused-tracks':{const used=new Set(allClips().map(clip=>clip.track)),rows=(project.cloud?.timelineLaneIds||[]).map((id,row)=>id&&!used.has(row)?row:null).filter(row=>row!==null);if(!rows.length)return toast('Delete Unused Tracks: every track has regions.');return confirmAction('Delete Unused Tracks',`<p>Delete ${rows.length} track${rows.length===1?'':'s'} without regions: ${rows.map(row=>esc(project.trackNames?.[row]||`Track ${row+1}`)).join(', ')}?</p>`,'Delete').then(async ok=>{if(!ok)return;for(const row of rows.sort((a,b)=>b-a))await deletePlaylistTrack(row);});}
  case 'unmute-all':{const rows=(project.cloud?.timelineLaneIds||[]).map((id,row)=>row).filter(row=>playlistTrackLaneMute(row)===true);if(!rows.length)return toast('Mute off for all: no track is muted.');return rows.forEach(row=>togglePlaylistTrackMute(row));}
  case 'clear-solo':{const rows=$$('#track-lanes .track-label[data-track]').filter(label=>label.querySelector('.logic-track-s.on')).map(label=>Number(label.dataset.track));if(!rows.length){const kept=logicKeyCommand.recallSolo||[];if(!kept.length)return toast('Clear/Recall Solo: no track is soloed.');logicKeyCommand.recallSolo=[];return kept.forEach(row=>togglePlaylistTrackSolo(row));}logicKeyCommand.recallSolo=rows;return rows.forEach(row=>togglePlaylistTrackSolo(row));}
  case 'copy-channel-strip':case 'paste-channel-strip':{const row=selectedTrackRow(),laneId=row===null?null:project.cloud.timelineLaneIds[row];if(!laneId)return toast('Select a track first (click its header).');return name==='copy-channel-strip'?window.illogic.copyChannelStripSetting(laneId):window.illogic.pasteChannelStripSetting(laneId);}
  case 'plugin-preset':{const windowEl=[...$$('dialog.logic-plugin-window[open]')].pop(),button=windowEl?.querySelector(number>0?'[data-plugin-preset="next"]':'[data-plugin-preset="previous"]');if(!windowEl)return toast('Next / Previous Setting: open a plug-in window first.');if(!button||button.disabled)return toast(button?.title||'This plug-in has no factory programs to step through.');return button.click();}
  case 'add-plugin':return openSelectedMixerTools().catch(fail);
  case 'mixer-mode':{const order=['single','tracks','all'],current=$('#mixer').dataset.mixerFilter||'all',next=order[(order.indexOf(current)+1)%order.length];setMixerFilter(next);return toast(`Mixer: ${({single:'Single',tracks:'Tracks',all:'All'})[next]}`);}
  case 'create-bus':return window.illogic.createBus();
  case 'mixer-view-menu':return $('#mixer-menu-view')?.click();
  case 'select-strip':{const rows=currentMixerModel().rows,at=rows.indexOf(currentMixerRow()),next=rows[Math.max(0,Math.min(rows.length-1,at+number))];if(!next)return;selectedMixerKey=next.key;if(next.kind!=='bus')mixerChannel=next.id;return renderMixer();}
  case 'select-strips':{const rows=currentMixerModel().rows,match=rows.filter(row=>arg==='master'?row.kind==='bus'&&row.id==='master':arg==='bus'?row.kind==='bus'&&row.id!=='master':arg==='muted'?row.values?.mute?.value===true:row.kind!=='bus'&&((project.cloud?.rawProject?.lanes||[]).find(lane=>lane.id===row.id)?.kind==='audio')===(arg==='audio'));if(!match.length)return toast(`No ${({audio:'audio',instrument:'software instrument',bus:'auxiliary',master:'output',muted:'muted'})[arg]} channel strips.`);selectedMixerKey=match[0].key;renderMixer();return toast(`${match.length} ${({audio:'audio',instrument:'software instrument',bus:'auxiliary',master:'output',muted:'muted'})[arg]} channel strip${match.length===1?'':'s'}: ${match.map(row=>row.name||row.label||row.id).slice(0,4).join(', ')} (one strip is selected at a time).`);}
  // ── Selection (regions in the Tracks area, notes in the Piano Roll)
  case 'deselect-all':if(inPiano){clearPianoSelection();return renderPiano();}return logicSelectRegions([]);
  case 'invert-selection':if(inPiano){const all=logicPianoNotes();return logicSelectNotes(all.filter(note=>!selectedNotes.has(note.id)));}return logicSelectRegions(allClips().filter(clip=>!playlistSelection.ids.has(clip.id)));
  case 'select-following':{if(inPiano){const picked=logicPianoNotes().filter(note=>selectedNotes.has(note.id));if(!picked.length)return need('Select All Following');const from=Math.min(...picked.map(note=>note.start)),pitches=new Set(picked.map(note=>note.pitch));return logicSelectNotes(logicPianoNotes().filter(note=>note.start>=from&&(arg!=='same'||pitches.has(note.pitch))));}const regions=logicSelectedRegions();if(!regions.length)return need('Select All Following');const from=regions[0].start,rows=new Set(regions.map(clip=>clip.track));return logicSelectRegions(allClips().filter(clip=>clip.start>=from&&(arg!=='same'||rows.has(clip.track))));}
  case 'select-inside-locators':{const area=logicCycleArea();if(!area)return toast('Select All Inside Locators: set a cycle area first.');if(inPiano)return toast('Select All Inside Locators applies to regions; focus the Tracks area.');return logicSelectRegions(allClips().filter(clip=>clip.start>=area.startBeat-1e-6&&clip.start+clip.length<=area.endBeat+1e-6));}
  case 'select-muted':if(inPiano)return logicSelectNotes(logicPianoNotes().filter(note=>note.muted===true));return logicSelectRegions(allClips().filter(clip=>regionMuteState(clip)===true));
  case 'select-overlapped':{if(inPiano){const all=logicPianoNotes();return logicSelectNotes(all.filter(note=>all.some(other=>other!==note&&other.pitch===note.pitch&&other.start<note.start+note.duration&&note.start<other.start+other.duration)));}const all=allClips();return logicSelectRegions(all.filter(clip=>all.some(other=>other!==clip&&other.track===clip.track&&other.start<clip.start+clip.length&&clip.start<other.start+other.length)));}
  case 'select-equal':{if(inPiano){const picked=logicPianoNotes().filter(note=>selectedNotes.has(note.id));if(!picked.length)return need('Select Equal');const pitches=new Set(picked.map(note=>note.pitch));return logicSelectNotes(logicPianoNotes().filter(note=>pitches.has(note.pitch)));}const regions=logicSelectedRegions();if(!regions.length)return need('Select Equal');const keys=new Set(regions.map(clip=>clip.patternId||`audio:${clip.name}`));return logicSelectRegions(allClips().filter(clip=>keys.has(clip.patternId||`audio:${clip.name}`)));}
  case 'select-edge':{if(inPiano){const all=[...logicPianoNotes()].sort((a,b)=>a.start-b.start||a.pitch-b.pitch);if(!all.length)return;return logicSelectNotes([arg==='first'?all[0]:all[all.length-1]]);}const all=[...allClips()].sort((a,b)=>a.start-b.start||a.track-b.track);if(!all.length)return;return logicSelectRegions([arg==='first'?all[0]:all[all.length-1]]);}
  // ── Piano Roll notes
  case 'select-pitch-edge':{const pool=selectedNotes.size?logicPianoNotes().filter(note=>selectedNotes.has(note.id)):logicPianoNotes();if(!pool.length)return toast('There are no notes in this region.');const starts=new Map();for(const note of pool){const key=Math.round(note.start*960),best=starts.get(key);if(!best||(arg==='high'?note.pitch>best.pitch:note.pitch<best.pitch))starts.set(key,note);}return logicSelectNotes([...starts.values()]);}
  case 'select-same-subposition':{const picked=logicPianoNotes().filter(note=>selectedNotes.has(note.id));if(!picked.length)return need('Select Same Subpositions');const sub=new Set(picked.map(note=>Math.round((note.start%4)*960)));return logicSelectNotes(logicPianoNotes().filter(note=>sub.has(Math.round((note.start%4)*960))));}
  case 'extend-note':{const all=[...logicPianoNotes()].sort((a,b)=>a.start-b.start||a.pitch-b.pitch);if(!all.length)return;const indexes=all.map((note,index)=>selectedNotes.has(note.id)?index:-1).filter(index=>index>=0),next=number>0?(indexes.length?Math.max(...indexes)+1:0):(indexes.length?Math.min(...indexes)-1:all.length-1);if(next<0||next>=all.length)return;selectedNotes.add(all[next].id);selectedNote=all[next].id;return renderPiano();}
  case 'mute-notes':if(!selectedNotes.size)return need('Mute Notes');return toggleSelectedNotesMuted();
  case 'split-notes-at-playhead':{/* Logic splits at the playhead: the Piano Roll cursor follows it when the playhead is inside the region */const region=(project.clips||[]).find(clip=>clip.patternId===pattern().id),local=playheadBeatNow()-(region?.start||0);if(region&&local>0&&local<region.length)pianoCursor=local;if(restructurePianoNotes('slice')===false)toast('Split at Playhead: move the playhead (or click the Piano Roll ruler) inside a note first.');return;}
  case 'note-overlap-correction':case 'note-legato':if(!selectedNotes.size)return need(name==='note-legato'?'Force Legato':'Note Overlap Correction');return logicTrimNoteEnds({pool:'all',force:name==='note-legato',gap:8});
  case 'nudge-note-length':if(!selectedNotes.size)return need('Nudge Length');return transformPianoNotes(notes=>notes.map(note=>({...note,duration:Math.max(pianoMinimumNote(pattern()),note.duration+number*(pianoSnap()||pianoMinimumNote(pattern())))})));
  case 'move-notes-to-playhead':{if(!selectedNotes.size)return need('Move to Playhead');const region=(project.clips||[]).find(clip=>clip.patternId===pattern().id),local=Math.max(0,playheadBeatNow()-(region?.start||0));return transformPianoNotes(notes=>{const first=Math.min(...notes.map(note=>note.start));return notes.map(note=>({...note,start:Math.max(0,note.start-first+local)}));});}
  case 'trim-notes-to-playhead':{if(!selectedNotes.size)return need('Set Note Start / End to Playhead');const region=(project.clips||[]).find(clip=>clip.patternId===pattern().id),local=playheadBeatNow()-(region?.start||0),min=pianoMinimumNote(pattern());return transformPianoNotes(notes=>notes.map(note=>arg==='end'?(local-note.start>=min?{...note,duration:local-note.start}:note):(note.start+note.duration-local>=min&&local>=0?{...note,start:local,duration:note.start+note.duration-local}:note)));}
  case 'toggle-midi-out':return $('#piano-midi-out')?$('#piano-midi-out').click():togglePianoPreviewNotes();
  // ── Step Sequencer rows
  case 'step-rotate-row':{const ids=rackStepChannelIds(rackStepChannelIds(null).length?null:channel().id);if(!ids.length)return toast('Rotate Row: select a step row first.');return rotateRackChannels(ids,number);}
  case 'step-rotate-pattern':{const ids=rackDisplayRows().map(row=>rackStepKey(row)).filter(Boolean);if(!ids.length)return toast('Rotate Pattern: this pattern has no step rows.');return rotateRackChannels(ids,number);}
  case 'step-copy-row':return rackClipboardAction('copy');
  case 'step-paste-row':if(!rackClipboard)return toast('Paste Row: copy a row first (⌃C).');return rackClipboardAction('paste');
  case 'step-clear-row':case 'step-clear-pattern':{const ids=name==='step-clear-pattern'?rackDisplayRows().map(row=>rackStepKey(row)).filter(Boolean):rackStepChannelIds(rackStepChannelIds(null).length?null:channel().id);if(!ids.length)return toast('Select a step row first.');return rackStepOperation(ids,name==='step-clear-pattern'?'Clear Pattern':'Clear Row',row=>row.map(()=>false));}
  case 'step-delete-row':return project.channels.length===1?toast('Delete Row: a pattern keeps at least one row.'):deleteChannelConfirm(channel());
  case 'step-rename-row':return channelAppearanceDialog(channel());
  case 'step-mute-row':case 'step-solo-row':{const label=name==='step-mute-row'?'Mute Row':'Solo Row',row=$('#rack-channels .rack-channel.selected')||$(`#rack-channels .rack-channel[data-channel="${CSS.escape(String(channel().id))}"]`),button=row?.querySelector(name==='step-mute-row'?'.channel-enable':'.step-solo');if(!button)return toast(`${label}: select a row first.`);if(button.disabled)return toast(`${label}: ${button.title||'this row is not used in the pattern.'}`);return button.click();}
  case 'step-edit-mode':{const shown=!!rackGraph?.visible;if((arg==='velocity')!==shown)toggleRackGraph();return toast(`Edit mode: ${arg==='velocity'?'Velocity':'Step On/Off'}`);}
  case 'step-subrows':{const shown=!!rackGraph?.visible;if((arg==='1')!==shown)toggleRackGraph();return;}
  default:return toast(`${name}: this key command is not connected yet.`);
 }
}
/** Catch Playhead (`): while playing, the Tracks area pages forward when the playhead leaves the visible bars. */
let logicCatch=true;try{logicCatch=localStorage.getItem('illogic:catch')!=='false';}catch{}
function logicCatchPlayhead(t){if(!logicCatch||!t?.playing||t.previewing||!Number.isFinite(Number(t.beat))||windows?.dragging||engine.interacting)return;const viewport=$('#arrangement-scroll');if(!viewport||!viewport.clientWidth)return;const x=Number(t.beat)/4*barWidth,left=viewport.scrollLeft,width=viewport.clientWidth-PLAYLIST_GUTTER;if(x>left+width-8||x<left-1)viewport.scrollLeft=Math.max(0,x-24);}
/** Piano Roll ▸ Edit ▸ Trim: set the end of each selected note from the next note of a pool: the other selected notes, any
 * following note, or the next note of the same pitch ("repeated"). `force` moves the end even without an overlap (legato);
 * `gap` is the space left before the next note in ticks of 1/960 beat (negative = overlap). */
function logicTrimNoteEnds({pool='all',force=false,gap=8}={}){
 if(!selectedNotes.size)return toast('Select one or more notes first.');const all=logicPianoNotes(),min=pianoMinimumNote(pattern());
 return transformPianoNotes(notes=>{const picked=new Set(notes.map(note=>note.id));return notes.map(note=>{const next=all.filter(other=>other.id!==note.id&&other.start>note.start+1e-9&&(pool==='selected'?picked.has(other.id):pool==='pitch'?other.pitch===note.pitch:true)).sort((a,b)=>a.start-b.start)[0];if(!next||!force&&next.start>=note.start+note.duration-1e-9)return note;return{...note,duration:Math.max(min,next.start-note.start-gap/960)};});});
}
const logicShell=installLogicShell({
 document,menu,toast,fail,dialog,textDialog,command:(name,args)=>logicKeyCommand(name,args),mainMenu:name=>menuItems[name]?.()||[],catchEnabled:()=>logicCatch,
 getProject:()=>project,findClip,allClips,selectedIds:()=>playlistSelection.ids,
 selectRegions:ids=>{playlistSelection.select(ids);selectedClip=playlistSelection.ids.values().next().value||null;paintPlaylistSelection();},
 activeEditor,dialogOpen:event=>shortcutDialogOpen(event),showWindow,windowVisible:id=>!!$('#'+id)&&!$('#'+id).classList.contains('hidden'),
 getTool:()=>tool,setTool:name=>$(`button[data-tool="${name}"]`)?.click(),editable:()=>playlistEditable(),
 playheadBeat:playheadBeatNow,jumpTo:beat=>playlistCursorJump(beat),goToStart:()=>playlistHome(),clock:()=>engine.positionAt?.()||{},
 toggleCycle:()=>toggleLoopPlayback(),playFromSelection:()=>playFromSelection(),setLocators:(startBeat,endBeat)=>playlistLoop.apply({enabled:true,startBeat,endBeat}),
 record:()=>$('#record').click(),toggleMetronome:()=>toggleMetronomeUi(),toggleTyping:()=>typingToggle.click(),typingEnabled:()=>typingEnabled,
 undo,redo,showHistory,clipboard:action=>playlistClipboardAction(action),deleteSelected,repeat:()=>queuePlaylistDuplicate(),
 split:(clip,beat)=>clip.patternId?slicePatternPlacement(clip,beat):sliceAudioClip(clip,beat),snapBeat:beat=>quantize(beat),barWidth:()=>barWidth,
 toggleRegionMute:toggleRegionMutes,regionMuted:regionMuteState,renameRegion,
 openPianoRoll:clip=>{selectPattern(clip.patternId);showWindow('piano');},makeUnique:clip=>makeUnique(clip.id),openSampleEditor:clip=>openSampleEditor(clip),
 regionEffect:clip=>regionEffects.open({clipId:clip.cloudId}),stemSplitter:clip=>logicRegionTools.openStemSplitter(clip),stemSplitterState:()=>restMixer?.isRestMode!==true?false:logicRegionTools?.stems?.busy?'running':null,addToStepSequencer:clip=>addAudioClipToRack(clip),openAutomation:clip=>openAutomation(clip),
 reloadWaveform:clip=>{clipWaveforms.invalidate(clip.cloudId);queueCloudWaveforms();},regionProperties:clip=>audioProperties(clip),
 audioRange:()=>rangeEdits.open(),timing:()=>timingDialog.open(),clearPatternRegions:()=>clearPlaylistConfirm(),
 newTracks:()=>$('#new-track').click(),newTrackOfKind:kind=>openTrackMenu(kind),joinNotes:()=>selectedNotes.size<2?toast('Select two or more notes to join (⌘J).'):restructurePianoNotes('glue'),goToPosition:()=>textDialog('Go to Position','Bar (or bar.beat)',String(Math.floor(editCursorBeat/4)+1),value=>{const match=/^\s*(\d+)(?:[ .:](\d+))?\s*$/.exec(String(value));if(!match)return toast('Enter a bar number, or bar.beat (for example 5 or 5.3).');playlistCursorJump((Math.max(1,Number(match[1]))-1)*4+Math.max(0,Math.min(3,Number(match[2]||1)-1)));}),importAudio:()=>{importedTarget=null;$('#import-audio').click();},openCloudPanel:()=>openCloudPanel(),
 bounce:()=>exportWav(),importMidi:()=>midiImport(),importOther:()=>importAnyFile(),undoHistory:()=>undoHistoryDialog(),deleteTrack:row=>deletePlaylistTrack(row),duplicateTrack:row=>duplicatePlaylistTrack(row),moveTrack:(row,to)=>dragPlaylistTrack(row,to),
 view:()=>playlistView(),applyView:view=>applyPlaylistView(view),zoomBy:(factor,anchor)=>{if(logicZoomBusy())return false;return timelineViewport.zoomBy(factor,anchor);},zoomPiano:factor=>{if(logicZoomBusy())return false;return pianoViewport.zoomBy(factor,0);},zoomToFit:()=>activeEditor()==='piano'?fitPianoView():fitPlaylistView(),minScale:()=>timelineViewport.min,maxScale:()=>timelineViewport.max,
 laneId:row=>project.cloud?.timelineLaneIds?.[row]||null,laneKind:row=>(project.cloud?.rawProject?.lanes||[]).find(lane=>lane.id===project.cloud?.timelineLaneIds?.[row])?.kind||null,trackName:row=>project.trackNames?.[row]||`Track ${row+1}`,
 trackMixerRow:row=>playlistTrackMixerRow(project.cloud?.timelineLaneIds?.[row]),toggleTrackMute:row=>togglePlaylistTrackMute(row),toggleTrackSolo:row=>togglePlaylistTrackSolo(row),setTrackControl:setTrackMixerControl,liveTrackControl:liveTrackMixerControl,liveMixGesture,
 masterRow:masterMixerRow,setMasterGain:(before,value)=>{const row=masterMixerRow();if(!row?.controls?.gain?.enabled)throw new Error('Stereo Out gain is unavailable.');return mixerControl({row:structuredClone(row),before,value,scope:mixerScope()},'gain');},
 selectMixerLane:laneId=>{selectedMixerKey=mixerRowKey('lane',laneId);mixerChannel=laneId;renderMixer();},
 createRegionAt:(track,beat,kind)=>typeof window.illogic?.createPatternRegionAt==='function'?window.illogic.createPatternRegionAt(track,beat,kind):toast('Region creation is not available yet.'), logicCopy, cancelFileDrop:()=>fileDrop?.cancel(),trackRect:row=>{const grid=$(`#track-lanes .lane-grid[data-track="${row}"]`),host=$('#arrangement');if(!grid||!host)return null;const g=grid.getBoundingClientRect(),h=host.getBoundingClientRect();return{left:g.left-h.left,top:g.top-h.top,height:g.height};},
 repeatNotes:()=>{if(!selectedNotes.size)return toast('Select notes to repeat (⌘R).');return duplicatePianoNotes();},channelStripSetting:(laneId,event)=>channelStripSettingMenu(laneId,event),
 toggleMixer:force=>toggleMixer(force),toggleAutomation:force=>toggleAutomationView(force),mountInspectorStrips:(element,options)=>mountInspectorStrips(element,options),mixerReady:()=>!!mixerStripViewOptions
});
// Logic opens with the Tracks area filling the window: Mixer (X) and Editors (E / P / double-click) closed.
try{toggleMixer(false);closeEditorPane();}catch(error){clientLog('illogic-default-layout',{message:String(error?.message||error).slice(0,160)});}
/* when this page last stored a project snapshot (Save) */let projectSnapshotAt=null;
// ── Trashlab shell (tl-shell.js): header pills, hamburger menu, bottom bar, drawers, Add Track modal. Presentation and routing only.
const trashlabShell=installTrashlabShell({
 document,logicShell,menu,toast,fail,dialog,mainMenu:name=>menuItems[name]?.()||[],menuOrder:MAIN_MENU_ORDER,
 getProject:()=>project,setTitle:title=>edit(()=>{project.title=title;}),engineReady:()=>!!engine.ready,
 isDirty:()=>dirty,savedAt:()=>projectSnapshotAt,publish:()=>exportWav(),invite:()=>inviteCollaboratorDialog(),
 masterRow:masterMixerRow,setMasterGain:(before,value)=>{const row=masterMixerRow();if(!row?.controls?.gain?.enabled)throw new Error('Master volume is unavailable.');return mixerControl({row:structuredClone(row),before,value,scope:mixerScope()},'gain');},
 /* master volume drag: heard now through the live path, never saved (the release goes through setMasterGain) */
 liveMasterGain:value=>{const row=masterMixerRow();return !!row?.controls?.gain?.enabled&&liveMixerControl({row,value,scope:mixerScope()},'gain');},liveMixGesture,
 selectMaster:()=>{selectedMixerKey=mixerRowKey('bus','master');mixerChannel='master';renderMixer();},
 toggleMixer:force=>toggleMixer(force),timing:()=>timingDialog.open(),newTrackOfKind:kind=>openTrackMenu(kind),importFile:()=>importAnyFile(),newDrumMachineTrack:()=>newDrumMachineTrack(),
 view:()=>playlistView(),applyView:view=>applyPlaylistView(view),realTrackCount:()=>logicRealTrackCount(),clock:()=>engine.positionAt?.()||{},
 /* 'audio' | 'pattern' | null for the selected region: the Editor button opens the matching editor */
 selectedRegionKind:()=>{const clip=selectedClip?findClip(selectedClip):null;return clip?(clip.patternId?'pattern':'audio'):null;}
});
window.trashlab=trashlabShell;
for(const button of $$('[data-window]'))button.classList.toggle('lit',!!$('#'+button.dataset.window)&&!$('#'+button.dataset.window).classList.contains('hidden'));
logicShell.decorateTracks();logicShell.renderInspector();
window.vegetableStudio.logicShell=logicShell;
/* Fade tool, region Gain / Fade In / Fade Out, track R / I, Count-in and LCD key (logic-region-tools.js). */
const logicRegionTools=installRegionTools({document,hooks:logicShellHooks,getProject:()=>project,findClip,allClips,getTool:()=>tool,editable:()=>playlistEditable(),toast,fail,
 studioClient:()=>restMixer?.isRestMode===true?restMixer.client:null,projectId:()=>engine.ready&&!engine.loading?engine.projectId:null,history:()=>engine.patternHistory,
 invalidateWaveform:clipId=>{clipWaveforms.invalidate(clipId);queueCloudWaveforms();},renderInspector:()=>logicShell.renderInspector(),
 // 345: setClipGain / stems / key writes adopt the returned revision, then re-read the canonical project (lanes, clips, key).
 dialog,refresh:()=>engine.refresh(),projectRevision:()=>studioEtag(engine.projectId),adoptRevision:(projectId,{base,etag})=>adoptStudioWrite(projectId,{base,etag}),selectedIds:()=>playlistSelection.ids,
 laneId:row=>project.cloud?.timelineLaneIds?.[row]||null,laneKind:row=>(project.cloud?.rawProject?.lanes||[]).find(lane=>lane.id===project.cloud?.timelineLaneIds?.[row])?.kind||null,trackName:row=>project.trackNames?.[row]||`Track ${row+1}`,
 recording:()=>!!(engine.recorder?.recording||engine.recordingContext),log:clientLog});
window.vegetableStudio.regionTools=logicRegionTools;
window.vegetableStudio.playFromSelection=playFromSelection;window.vegetableStudio.playheadBeat=playheadBeatNow;window.vegetableStudio.midiPanic=midiPanic;
/* Logic Smart Tempo “Keep / Adapt Project Tempo” (LCD KEEP/ADAPT; logic-tempo-adapt.js): Adapt sends
 * setProjectTempo mode stretch_audio as ONE history step (Undo = undoTempoStretchJob, Redo = the stretch again). */
const logicTempoAdapt=installTempoAdapt({document,storage:(()=>{try{return window.localStorage;}catch{return null;}})(),projectId:()=>engine.ready&&!engine.loading?engine.projectId:null,
 studioClient:()=>restMixer?.isRestMode===true?restMixer.client:null,getProject:()=>project,menu,toast,fail,status:text=>{if(text||/^(Adapting audio|Restoring the audio)/.test($('#hint').textContent)){$('#hint').textContent=text;$('#status-message').textContent=text;}},
 controller:new TempoAdaptController({client:()=>restMixer?.isRestMode===true?restMixer.client:null,scope:()=>{const projectId=engine.ready&&!engine.loading?engine.projectId:null;return projectId?{projectId}:null;},history:()=>engine.patternHistory,log:clientLog,prepare:()=>engine.flush?.(),
  // The stretch swapped clip audio, starts and lengths: re-read the project and every waveform.
  refresh:async()=>{await engine.refresh();clipWaveforms.invalidate();queueCloudWaveforms();},onChange:()=>window.vegetableStudio?.tempoAdapt?.paint()})});
window.vegetableStudio.tempoAdapt=logicTempoAdapt;
/* Studio API extras (logic-freestyle-extras.js): Import ▸ Audio from URL… (one import Undo step), Export History…,
 * Share ▸ Collaborators…, Assistant job status / Undo Last Assistant Action, Listen reusing a current cloud mix. */
const freestyleExtras=installFreestyleExtras({dialog,confirm:confirmAction,toast,fail,log:clientLog,eventTarget:window,
 studioClient:()=>restMixer?.isRestMode===true?restMixer.client:null,projectId:()=>engine.ready&&!engine.loading?engine.projectId:null,trackId:()=>engine.session.trackId||null,scope:()=>fileImportScope(),
 busy:()=>workspaceBusy()||!coreFileEditable()||tempoAdaptBusy()?'Wait for the current cloud operation to finish.':null,flush:()=>engine.flush(),
 refresh:async()=>{await engine.refresh();clipWaveforms.invalidate();queueCloudWaveforms();},onReloadRequired:info=>engine.liveReloadRequired?.(info),
 importWithHistory:async perform=>{audioImportBusy=true;try{const result=await importAudioWithHistory(null,null,undefined,{perform});await engine.refresh();return result;}finally{audioImportBusy=false;mixerView?.render();}},
 playhead:()=>{const seconds=Number(engine.session.positionSeconds)||0;return{seconds,label:`bar ${Math.floor((Number(engine.beat)||0)/4)+1}`};},
 timelineRevision:()=>studioEtag(engine.projectId),projectUpdatedAt:()=>project.cloud?.rawProject?.updatedAt??null,
 renderListen:()=>engine.listenPreview(),stopListen:()=>engine.session.streamAudio?.pause?.(),openAssistant:()=>openCloudTool('mozart_ai_command')});
window.vegetableStudio.freestyleExtras=freestyleExtras;
/* Library (Y): patches of the selected software-instrument track (logic-patch-library.js): search_patches /
 * set_patch over /api/call (the Cloud Engine panel's route); a load is ONE history step when the previous patch is known. */
try{window.vegetableStudio.patchLibrary=installPatchLibrary({document,toast,fail,selectedLaneId:()=>project.cloud?.timelineLaneIds?.[logicShell.state.selectedTrack??0]||null,
 controller:new PatchLibraryController({session:()=>engine.ready&&!engine.loading?engine.session:null,scope:()=>engine.ready&&!engine.loading&&engine.projectId?{projectId:engine.projectId}:null,
  refresh:()=>engine.refresh(),prepare:()=>engine.flush?.(),editable:()=>directLevelEditable()&&!engine.interacting,history:()=>engine.patternHistory,log:clientLog})});}
catch(error){clientLog('illogic-patch-library',{message:String(error?.message||error).slice(0,160)});}
window.illogic=Object.assign(window.illogic||{},{selectFadeTool:()=>$('button[data-tool="fade"]')?.click(),channelStripSetting:(laneId,event)=>channelStripSettingMenu(laneId,event),copyChannelStripSetting:laneId=>{const item=channelStripSettingEntries(laneId).find(entry=>entry.id==='copy-strip');return item.disabled?toast(item.title):item.run();},pasteChannelStripSetting:laneId=>{const item=channelStripSettingEntries(laneId).find(entry=>entry.id==='paste-strip');return item.disabled?toast(item.title):item.run();},openHumanize:()=>openHumanizeDialog(dialog,{selection:selectedNotes.size,onApply:options=>transformPianoNotes(notes=>humanizeNotes(notes,options))}),createBus:()=>openBusSettings().catch(fail)});
