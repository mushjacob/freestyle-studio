/** Visible UI capability gates for the generated Studio API contract.
 * These predicates perform no network calls and never fall back to MCP.
 */
import {STUDIO_API_OPERATIONS} from './studio-api-client.js';
const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;};

export const STUDIO_API_UI_FEATURES=freeze({
 record_microphone:{label:'Record microphone',operations:[['getTurnCredentials','sendLiveIngestOffer','closeLiveIngest','getLiveIngestStatus','uploadAudio']],transport:'webrtc-ingest',reason:'Microphone recording is unavailable in this API build.',selectors:['#record'],entrypoints:['toggleRecord'],note:'The current recorder sends take_start/take_stop over the ingest data channel; it does not require an absent REST start_recording operation. Gate start only; always allow an active take to stop.'},
 metronome:{label:'Metronome',operations:[['engine_set_metronome']],engineActions:['set_metronome'],reason:'The metronome control is awaiting a Freestyle API update.',selectors:['#metronome'],entrypoints:['toggleMetronomeUi','coreShortcutHandlers.metronome']},
 create_audio_lane:{label:'Add audio or vocal track',operations:[['createLane']],reason:'Adding tracks is unavailable in this API build.',selectors:['#new-track'],entrypoints:['laneCreateDialog.create']},
 create_instrument:{label:'Add instrument',operations:[['createInstrumentLane']],engineActions:['create_empty_lane','load_labs'],reason:'Instrument creation is awaiting a Freestyle API update. Existing instruments remain playable.',selectors:['.lane-create-form [name=kind] option[value=instrument]'],entrypoints:['addChannel','emptyInstrument.create','MIDI import target=new'],note:'Disable only the instrument option in New track; createLane still supports audio/vocal. MIDI import into an existing instrument remains available.'},
 add_drum_channel:{label:'Add drum channel',operations:[['addDrumChannel']],engineActions:['set_pattern_steps'],reason:'Adding a new drum sound is awaiting a Freestyle API update. Existing drum steps remain editable.',selectors:[],entrypoints:['addChannel(kick|clap|hat|snare|openhat)']},
 plugin_add:{label:'Add plugin',operations:[['listPluginCatalog','addLanePlugin']],engineActions:['list_tracks','load_track_plugin'],reason:'Adding a plugin is awaiting a Freestyle API update. Loaded-plugin controls remain available.',selectors:['.mix-empty-slot','[data-add]','.mix-catalog-item'],entrypoints:['MixerToolsController.loadPlugin']},
 plugin_lane_topology:{label:'Move or remove lane plugin',operations:[['moveLanePlugin','deleteLanePluginInstance']],reason:'Moving or removing lane plugins is unavailable in this API build.',selectors:[],entrypoints:[]},
 plugin_lane_remove:{label:'Remove lane plugin',operations:[['deleteLanePluginInstance']],reason:'Removing plugins is unavailable in this API build.',selectors:['[data-remove]'],entrypoints:['MixerToolsController.remove']},
 plugin_lane_move:{label:'Move lane plugin',operations:[['moveLanePlugin','listLanePlugins','getSavedLanePluginState']],reason:'Moving lane plugins is unavailable in this API build.',selectors:['[data-up]','[data-down]'],entrypoints:['MixerToolsController.move']},
 plugin_parameters:{label:'Plugin parameters',operations:[['listLanePlugins','listLanePluginParameters','setLanePluginParameter']],reason:'Plugin parameters are unavailable in this API build.',selectors:['[data-plugin-param]','[data-param]','[data-value]'],entrypoints:['pluginDialog','MixerToolsController.parameter']},
 plugin_slot_mix:{label:'Slot mix',operations:[['listLanePlugins','setLanePluginMix']],reason:'Slot mix is unavailable in this API build.',selectors:['[data-slot-mix]'],entrypoints:['MixerToolsController.slotMix']},
 plugin_bypass:{label:'Plugin bypass',operations:[['listLanePlugins','setLanePluginBypassed']],reason:'Plugin bypass is unavailable in this API build.',selectors:['[data-bypass]'],entrypoints:['MixerToolsController.bypass']},
 plugin_native_editor:{label:'Original plugin editor',operations:[['openPluginEditor','getPluginEditorStatus','closePluginEditor','releasePluginEditor']],requiresEditorBinding:true,reason:'Use the parameter controls while the original plugin editor becomes available.',selectors:['.plugin-original-gui'],entrypoints:['pluginDialog original GUI','CloudPluginEditor']},
 chain_preset_catalog:{label:'Chain presets',operations:[['listCatalogVocalChainPresets','getCatalogVocalChainPreset']],reason:'Chain preset browsing is awaiting a Freestyle API update.',selectors:['[data-tab=presets]'],entrypoints:['MixerToolsController.chainPresets','MixerToolsController.inspectPreset','MixerToolsController.applyPreset']},
 chain_preset_apply:{label:'Apply chain preset',operations:[['applyVocalChainPreset']],reason:'Applying a complete chain preset is awaiting a Freestyle API update. Browsing presets is available.',selectors:['.mix-apply-preset'],entrypoints:['MixerToolsController.applyPreset']},
 effect_preset_catalog:{label:'Effect presets',operations:[['listCatalogEffectPresets']],reason:'Effect preset browsing is awaiting a Freestyle API update.',selectors:['.mix-effect-browse'],entrypoints:['MixerToolsController.effectPresets']},
 library_own_assets:{label:'Your library',operations:[['listLibraryAssets']],reason:'Your library is unavailable in this API build.',selectors:[],entrypoints:['CloudLibraryBrowser packs/patterns/kits/plugins/effects'],note:'Own-library pages do not replace global sound search. Preserve opaque cursors up to512 characters.'},
 library_global_sounds:{label:'Sound browser',operations:[['browseCatalogSounds']],reason:'Global sound browsing is awaiting a Freestyle API update. Your library remains available.',selectors:['.library-tabs [title="Browse cloud sounds"]'],entrypoints:['CloudLibraryBrowser.open(sounds)','CloudLibraryBrowser.setSearch(sounds)']},
 library_pack_items:{label:'Open sound pack',operations:[['listCatalogPresetPackItems']],reason:'Opening sound-pack contents is awaiting a Freestyle API update.',selectors:[],entrypoints:['CloudLibraryBrowser.openPack']},
 library_audio_files:{label:'Cloud audio files',operations:[['listAudioLibrary']],reason:'Cloud file browsing is awaiting a Freestyle API update. Local audio imports remain available.',selectors:['.library-tabs [title="Browse cloud audio"]'],entrypoints:['CloudLibraryBrowser.open(audio)']},
 library_asset_details:{label:'Library asset details',operations:[['getMarketplaceAsset']],reason:'Library asset details are awaiting a Freestyle API update.',selectors:[],entrypoints:['CloudLibraryBrowser.inspectAsset']},
 library_project_samples:{label:'Project samples',operations:[['listPatternSamples']],reason:'Project samples are unavailable in this API build.',selectors:[],entrypoints:['CloudLibraryBrowser.open(project-samples)']},
 library_reuse_sample:{label:'Reuse project sample',operations:[['listPatternSamples','updatePattern']],reason:'Reusing project samples is unavailable in this API build.',selectors:[],entrypoints:['CloudLibraryBrowser.addRegisteredSample']},
 library_add_sound:{label:'Add library sound',operations:[['listCatalogPresetPackItems','registerPatternSample']],reason:'Adding library sounds is awaiting a Freestyle API update. Existing project samples remain usable.',selectors:['.library-sound-row .library-add'],entrypoints:['CloudLibraryBrowser.addSound']},
 library_apply_pattern:{label:'Apply library pattern',operations:[['applyMarketplacePattern']],reason:'Applying library patterns is awaiting a Freestyle API update. Existing patterns remain editable.',selectors:['.library-asset-row .library-add'],entrypoints:['CloudLibraryBrowser.applyPattern']},
 rack_file_upload:{label:'Drop file into Channel Rack',operations:[['uploadPatternSample']],reason:'Direct file drops into the Channel Rack are awaiting a sample-upload API update. Import into the Playlist, then use Add to Channel Rack.',selectors:['#rack'],entrypoints:['FileDropController Rack OS-file target','Channel Rack Import sample… picker'],note:'uploadAudio creates an audible Playlist take and is not an asset-only sample upload; uploadPatternSample stores sample bytes only.'},
 playlist_sample_place:{label:'Place sample on Playlist',operations:[['placePatternSampleOnTimeline']],reason:'Placing Browser or Channel Rack samples on the Playlist is awaiting a Freestyle API update. Drop them into the Channel Rack instead.',selectors:['#arrangement-scroll'],entrypoints:['Playlist application/vegetable-library-sound drop'],note:'References the same stored audio; no bytes move.'},
 register_existing_sample:{label:'Add audio clip to Channel Rack',operations:[['registerPatternSample']],reason:'Sample registration is unavailable in this API build.',selectors:[],entrypoints:['addAudioClipToRack']},
 sample_audition:{label:'Preview sample',operations:[['engine_preview_pattern_sample']],engineActions:['preview_pattern_sample'],reason:'One-shot sample preview is awaiting a Freestyle API update. Pattern playback remains available.',selectors:[],entrypoints:['CloudEngine.preview sample branch','library onPreview(existing sample)'],note:'Gate only the sample branch of piano-key/library audition before connecting the audio monitor. Rack .note-preview opens the Piano roll and must stay available. previewPattern could support an explicit inline one-shot adapter later, but that adapter is not the current preview_pattern_sample call.'},
 instrument_audition:{label:'Play existing instrument',operations:[['startAudioMonitor','sendMonitorOffer','getTurnCredentials']],transport:'webrtc-midi',reason:'Live instrument monitoring is unavailable in this API build.',selectors:['#typing-keyboard'],entrypoints:['CloudInstrumentAudition.noteOn','CloudEngine.preview instrument branch'],note:'Existing instrument notes use the monitor MIDI channel after REST monitoring setup; do not disable them with sample audition.'},
 native_undo:{label:'Undo',operations:[['undoEngineHistory']],engineActions:['history_undo'],localHistory:'undo',reason:'There is no retained edit to undo. Native engine history is awaiting a Freestyle API update.',selectors:['#undo'],entrypoints:['undo fallback','CloudEngine.history history_undo'],note:'Retained pattern/audio/range/region inverses are local journals backed by REST; leave those enabled independently. Do not substitute undoLastAiAction for a user edit.'},
 native_redo:{label:'Redo',operations:[['redoEngineHistory']],engineActions:['history_redo'],localHistory:'redo',reason:'There is no retained edit to redo. Native engine history is awaiting a Freestyle API update.',selectors:['#redo'],entrypoints:['redo fallback','CloudEngine.history history_redo']},
 native_history_panel:{label:'Native undo history',operations:[['getEngineHistory']],engineActions:['get_history'],reason:'Native engine history is awaiting a Freestyle API update.',selectors:[],entrypoints:['showHistory']},
 daw_project_import:{label:'Import FL Studio or Logic project',operations:[['importDawProject']],reason:'DAW project import is awaiting a Freestyle API update. Audio and MIDI imports remain available.',selectors:['#import-project'],entrypoints:['FileDropController DAW project import','File import FL Studio / Logic']},
 clip_gain:{label:'Audio clip gain',operations:[['engine_set_clip_gain']],engineActions:['set_clip_gain'],reason:'Individual clip gain is awaiting a Freestyle API update. Lane gain remains available.',selectors:[],entrypoints:['audioProperties volume field','CloudSession.applyProject set_clip_gain']},
 clip_move_lane:{label:'Move audio clip to another track',operations:[['moveClipToLane']],engineActions:['move_clip_to_lane'],reason:'Moving audio between tracks is awaiting a Freestyle API update. Timing edits on its current track remain available.',selectors:[],entrypoints:['Playlist audio drag to another lane','CloudSession.applyProject move_clip_to_lane']}
});

function operationSet(operations){return new Set(operations instanceof Set?operations:Array.isArray(operations)?operations:Object.keys(operations||{}));}
function engineGatewayReady(engineActions,operations){
 if(!engineActions||typeof engineActions.operationId!=='string'||!operations.has(engineActions.operationId)||engineActions.verified!==true)return false;
 return engineActions.actions instanceof Set||Array.isArray(engineActions.actions);
}
/** A known local journal or already-active recorder takes priority over missing
 * generic backend operations. Gate entry points as well as disabled buttons. */
export function studioApiFeatureAvailability(feature,{project,operations=STUDIO_API_OPERATIONS,engineActions=null,localHistory={},nativeEditorBound=false,microphoneAvailable=true,recordingActive=false}={}){
 const definition=STUDIO_API_UI_FEATURES[feature];if(!definition)throw Object.assign(new TypeError('Unknown Studio API feature: '+feature),{code:'studio_feature_unknown',dispatched:false});
 const restMode=project?.cloud?.rawState?.studioApi===true;
 const result={feature,label:definition.label,enabled:true,restMode,source:restMode?'rest':'legacy',reason:null,missingOperations:[],missingEngineActions:[],mcpFallback:false};
 if(!restMode)return result;
 if(feature==='record_microphone'&&recordingActive)return{...result,source:'active-recording'};
 if(definition.localHistory&&localHistory?.[definition.localHistory]===true)return{...result,source:'retained-history'};
 const supported=operationSet(operations),alternatives=definition.operations||[],available=alternatives.find(group=>group.length&&group.every(operation=>supported.has(operation)));
 let enabled=!!available,source=definition.transport??'rest';
 if(!enabled&&definition.engineActions?.length&&engineGatewayReady(engineActions,supported)){
  const actions=operationSet(engineActions.actions);result.missingEngineActions=definition.engineActions.filter(action=>!actions.has(action));if(!result.missingEngineActions.length){enabled=true;source='typed-engine-rest';}
 }
 if(!enabled){result.missingOperations=[...(alternatives.slice().sort((a,b)=>a.length-b.length)[0]||[])].filter(operation=>!supported.has(operation));result.reason=definition.reason;}
 if(enabled&&definition.requiresEditorBinding&&!nativeEditorBound){enabled=false;result.reason=definition.reason;}
 if(enabled&&feature==='record_microphone'&&!microphoneAvailable){enabled=false;result.reason='Microphone capture is unavailable in this browser.';}
 return{...result,enabled,source};
}

export function studioApiFeatureFlags(context={}){return Object.fromEntries(Object.keys(STUDIO_API_UI_FEATURES).map(feature=>[feature,studioApiFeatureAvailability(feature,context)]));}

/** Use at keyboard/menu/drop entry points before any discovery or audio offer. */
export function assertStudioApiFeature(feature,context){
 const availability=studioApiFeatureAvailability(feature,context);if(!availability.enabled)throw Object.assign(new Error(availability.reason),{code:'studio_operation_unavailable',feature,dispatched:false,missingOperations:availability.missingOperations});return availability;
}
