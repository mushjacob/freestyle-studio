"""Explicit Studio API v1 request compatibility; no network or credentials here.

Generated operation contracts: production OpenAPI 1.0.0; generated metadata is authoritative.
Only documented aliases are translated. Unsupported deterministic calls fail
closed; they are never sent to MCP. The caller owns HTTP, OAuth and ETag storage.
"""
from pathlib import Path
from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor
from threading import BoundedSemaphore
import json
import math
import re
from urllib.parse import quote, urlencode
from uuid import uuid4
from time import perf_counter

# Generated from the same authoritative OpenAPI snapshot as the browser client.
# Read the checked-in allowlist instead of carrying a second stale schema copy.
_GENERATED = json.loads((Path(__file__).resolve().parent / 'docs/studio-api-operations.json').read_text())
COMPONENTS = _GENERATED.get('components', {})
OPERATIONS = {name: {**operation,
    'body': ((operation.get('requestBody') or {}).get('content', {}).get('application/json', {}).get('schema') or {}),
    'bodyRequired': bool((operation.get('requestBody') or {}).get('required')),
    'equivalent': operation.get('mcpEquivalent'),
} for name, operation in _GENERATED['operations'].items()}


# One full project snapshot is five independent GETs; size the shared bound so
# a snapshot runs in one round trip without unbounded fan-out.
_READ_SLOTS = BoundedSemaphore(6)
# Background project refreshes (the engine's idle refresh after a change
# notification) read through their own pool, so a user's confirm read or
# Undo/Redo read never waits for a slot behind them (QA round 19: one Undo
# waited 2.2 s for a slot behind a 12.4 s background snapshot).
_BACKGROUND_READ_SLOTS = BoundedSemaphore(4)


def _send(request, send):
    # Sharing this bound across HTTP handlers avoids multiplying parallel reads
    # when get_project and get_pro_state arrive concurrently from one browser.
    if request['method'] == 'GET':
        started = perf_counter()
        with (_BACKGROUND_READ_SLOTS if getattr(send, 'read_priority', None) == 'background' else _READ_SLOTS):
            observer = getattr(send, 'record_read_slot_wait', None)
            if callable(observer):
                try:
                    observer((perf_counter() - started) * 1000)
                except Exception:
                    pass  # Diagnostics must never change dispatch or retry behavior.
            return send(request)
    return send(request)


def _parallel_reads(requests, send):
    if any(request.get('method') != 'GET' for request in requests.values()):
        raise ValueError('Only independent read operations can use the snapshot pool.')
    with ThreadPoolExecutor(max_workers=min(6, len(requests))) as pool:
        futures = {key: pool.submit(execute_plan, request, send) for key, request in requests.items()}
        return {key: future.result() for key, future in futures.items()}


class UnmappedStudioCall(ValueError):
    """A deterministic feature has no declared v1 contract; never fall back."""
    code = 'studio_api_feature_unavailable'
    status = 501
    stage = 'api_mapping'

    def __init__(self, name, action=None, reason=None):
        self.name, self.action = name, action
        self.reason = reason or 'No declared Studio API v1 operation covers this deterministic call.'
        super().__init__(f"{name}{'(' + action + ')' if action else ''}: {self.reason}")

    def details(self):
        return {'name': self.name, **({'action': self.action} if self.action else {}), 'reason': self.reason}


# These maps are generated from exact x-freestyle-mcp-equivalent annotations,
# then narrowed below where one annotation names several resource endpoints.
DIRECT_TOOLS = {}
PRO_ACTIONS = {}
for _operation_id, _operation in sorted(OPERATIONS.items(), key=lambda item: item[0].startswith('engine_')):
    _equivalent = _operation.get('equivalent') or ''
    if re.fullmatch(r'[a-z][a-z0-9_]+', _equivalent):
        DIRECT_TOOLS.setdefault(_equivalent, _operation_id)
    _match = re.fullmatch(r'execute_pro_action\(([a-z][a-z0-9_]+)\)', _equivalent)
    if _match:
        PRO_ACTIONS.setdefault(_match.group(1), _operation_id)
DIRECT_TOOLS.update({'upload_pattern_sample': 'uploadPatternSample', 'place_pattern_sample_on_timeline': 'placePatternSampleOnTimeline'})
# FL-style per-clip audio mute (310): the resource PUT, never lane mute or a gain substitute.
# execute_pro_action(set_clip_muted) resolves to the same operation via its annotation.
DIRECT_TOOLS['set_clip_muted'] = 'setClipMuted'
# The stage spec (regenerated client) annotates newer typed routes with equivalents this adapter already
# resolves to other operations. Keep the reviewed targets: clip gain stays the engine action whose track_id
# names the target lane, and renaming a project stays renameProject (no annotation names it).
# get_transport_clock needs no pin since GitHub issue #18: only getTransportClock carries that annotation among
# the typed routes (getRecordingStatus lost it), so the annotation map already resolves it there.
PINNED_PRO_ACTIONS = {'set_clip_gain': 'engine_set_clip_gain'}
PRO_ACTIONS.update({name: op for name, op in PINNED_PRO_ACTIONS.items() if op in OPERATIONS})
if 'renameProject' in OPERATIONS:
    DIRECT_TOOLS.setdefault('rename_project', 'renameProject')
# Upload admission and timeline placement must keep one caller-retained key per
# logical write; an unknown outcome is inspected, never replayed under a fresh
# generated key. Placement additionally needs the caller's fresh timeline ETag.
RETAINED_KEY_OPERATIONS = frozenset({'uploadPatternSample', 'placePatternSampleOnTimeline'})
IF_MATCH_OPERATIONS = frozenset({'placePatternSampleOnTimeline'})
DIRECT_TOOLS.update({'list_automation': 'listAutomation', 'get_saved_plugin_state': 'getSavedLanePluginState', 'update_automation': 'updateAutomationEnvelope',
    'list_plugin_catalog': 'listPluginCatalog', 'get_catalog_plugin': 'getCatalogPlugin',
    'list_instrument_catalog': 'listInstrumentCatalog',
    'list_lane_plugin_parameters': 'listLanePluginParameters',
    'list_bus_plugin_parameters': 'listBusPluginParameters'})
PRO_ACTIONS.update({
    'list_patterns': 'listPatterns', 'list_pattern_placements': 'listPatternPlacements',
    'restore_pattern_placement': 'restorePatternPlacement',
    # 338: channel add/patch/delete share the update_pattern annotation; the action stays the pattern PATCH.
    'update_pattern': 'updatePattern',
    'list_tracks': 'listEngineTracks', 'list_buses': 'engine_list_buses', 'get_transport': 'getTransport',
    'get_history': 'getEngineHistory', 'history_undo': 'undoEngineHistory', 'history_redo': 'redoEngineHistory',
    'send_midi': 'sendEngineMidi', 'all_notes_off': 'engineMidiAllNotesOff',
    'move_clip_to_lane': 'moveClipToLane',
    'start_recording': 'startRecording', 'finalize_recording': 'finalizeRecording',
    'add_lane_plugin': 'addLanePlugin', 'add_bus_plugin': 'addBusPlugin', 'delete_lane_plugin': 'deleteLanePlugin',
    'add_instrument_track': 'engine_add_instrument_track', 'get_bus_plugin_live_state': 'engine_get_bus_plugin_live_state',
    'set_lane_plugin_parameter': 'setLanePluginParameter', 'set_plugin_parameter': 'setLanePluginParameter',
    'set_plugin_bypassed': 'setLanePluginBypassed', 'get_plugin_state': 'getLanePluginState',
    'rename_track': 'updateLane', 'delete_track': 'deleteLane', 'route_track_to_bus': 'setLaneRouting',
})
# Only assistant/natural-language work retains MCP. A historical compose-family
# membership is not enough: deterministic setters and instrument loaders fail
# closed when their REST operations are absent.
AI_ONLY_TOOLS = frozenset({'mozart_ai_command'})
AI_ONLY_ACTIONS = frozenset({'compose', 'compose_song', 'refine_song', 'song_brief', 'mix_check', 'audit_arrangement', 'analyze_song_sections', 'analyze_harmony', 'detect_tempo'})
KNOWN_GAPS = {
    'get_history': 'Studio API v1 does not expose the native history stack.',
    'history_undo': 'Studio API v1 does not expose native engine Undo.',
    'history_redo': 'Studio API v1 does not expose native engine Redo.',
    'send_midi': 'Studio API v1 does not expose immediate MIDI audition.',
    'preview_pattern_sample': 'Studio API v1 does not expose individual sampler audition.',
    'create_empty_lane': 'The native empty-lane creation/acknowledgement contract is absent.',
    'load_labs': 'Studio API v1 has no instrument/plugin loader.',
    'add_instrument_track': 'Instrument creation is a deterministic UI action and has no declared v1 equivalent.',
    'set_metronome': 'Studio API v1 has no metronome setter.',
    'set_clip_gain': 'ClipBatchOp has timing fields only; clip gain is not a declared v1 write.',
    'move_clip_to_lane': 'ClipBatchOp has no lane field; cross-lane clip moves are not exposed.',
    'split_clip': 'Native clip split needs a declared endpoint or a separately verified canonical batch plan.',
    'copy_append_clip': 'Native copy/append needs a separately verified canonical insert plan.',
    'set_pattern_source_gain': 'Use a complete canonical pattern PATCH; no partial source-gain endpoint exists.',
    'set_pattern_steps': 'Use a complete canonical pattern PATCH; a steps-only endpoint is not declared.',
    'write_pattern_notes': 'Use a complete canonical pattern PATCH; a notes-only endpoint is not declared.',
    'load_track_plugin': 'Studio API v1 does not expose plugin insertion.',
    'load_bus_plugin': 'Studio API v1 does not expose plugin insertion.',
    'set_eq_band': 'This generic alias has no unambiguous target. Use the declared set_track_eq_band or set_pattern_eq_band action and its typed arguments.',
    'start_recording': 'Studio API v1 does not expose native recording start.',
    'finalize_recording': 'Studio API v1 does not expose native take finalization.',
    'browse_sounds': 'Studio API v1 exposes owned library assets, not the searchable sound catalog.',
    'list_audio_library': 'Studio API v1 does not expose the audio catalog.',
    'list_sound_pack_items': 'Studio API v1 does not expose sound-pack contents.',
    'get_marketplace_asset': 'Studio API v1 does not expose marketplace asset detail.',
    'apply_marketplace_pattern': 'Studio API v1 does not expose marketplace-pattern materialization.',
    'materialize_sound_pack_item': 'Studio API v1 does not expose sound-pack item materialization.',
    'list_effect_presets': 'Studio API v1 does not expose the effect preset catalog.',
    'list_vocal_chain_presets': 'Studio API v1 does not expose vocal-chain preset catalog.',
    'get_vocal_chain_preset': 'Studio API v1 does not expose vocal-chain preset detail.',
    'apply_vocal_chain_preset': 'Studio API v1 does not expose vocal-chain preset application.',
    'render_live_window': 'Studio API v1 does not expose live-window rendering.',
    'start_stream': 'The legacy stream endpoint is replaced by project monitoring; no equivalent stream result exists.',
    'stop_stream': 'Studio API v1 does not expose legacy stream shutdown.',
}
KNOWN_GAPS = {name: reason for name, reason in KNOWN_GAPS.items() if name not in PRO_ACTIONS and name not in DIRECT_TOOLS}
LIST_COLLECTIONS = {
    'listProjects': 'projects', 'listLibraryAssets': 'assets', 'listLanes': 'lanes',
    'listClips': 'clips', 'listPatterns': 'patterns', 'listPatternPlacements': 'placements',
    'listBuses': 'buses', 'listAutomation': 'envelopes', 'listClipAutomation': 'envelopes',
    'listLaneAutomation': 'envelopes', 'listPluginAutomation': 'envelopes',
    'listProjectSaves': 'saves', 'listPatternSamples': 'samples', 'listExports': 'exports',
    'browseCatalogSounds': 'items', 'browseCatalogMarketplace': 'assets',
    'listCatalogEffectPresets': 'presets', 'listCatalogVocalChainPresets': 'presets',
    'listCatalogPresetPackItems': 'items', 'listPluginCatalog': 'plugins', 'listInstrumentCatalog': 'instruments',
}
LANE_TARGET_ACTIONS = frozenset({'set_track_gain', 'set_track_pan', 'set_track_muted', 'set_track_soloed', 'rename_track', 'delete_track', 'route_track_to_bus', 'open_plugin_editor', 'close_plugin_editor', 'release_plugin_editor', 'get_plugin_editor_status'})
AUTOMATION_KEYS = {'default_value': 'defaultValue', 'value_type': 'valueType', 'expected_revision': 'expectedRevision'}


def _opaque(value, field):
    if not isinstance(value, str) or not value or value in ('.', '..') or len(value) > 128 or value != value.strip() or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValueError(f'{field} must be an opaque returned resource id, not a numeric engine index.')
    return value


def _schema_value(value, schema, field, depth=0):
    """Validate published JSON shapes/units without coercing engine values."""
    if depth > 128:
        raise ValueError(f'{field} exceeds the schema nesting limit.')
    if '$ref' in schema:
        ref = schema['$ref']
        if not ref.startswith('#/components/'):
            raise ValueError('Only published local schema references are supported.')
        target = COMPONENTS
        for part in ref[len('#/components/'):].split('/'):
            target = target[part.replace('~1', '/').replace('~0', '~')]
        _schema_value(value, target, field, depth + 1)
    for member in schema.get('allOf', []):
        _schema_value(value, member, field, depth + 1)
    for keyword in ('anyOf', 'oneOf'):
        if keyword in schema:
            valid = 0
            for member in schema[keyword]:
                try:
                    _schema_value(value, member, field, depth + 1)
                    valid += 1
                except ValueError:
                    pass
            if valid == 0 or keyword == 'oneOf' and valid != 1:
                raise ValueError(f'{field} does not match its declared shape.')
    kind = schema.get('type')
    kinds = kind if isinstance(kind, list) else [kind] if kind else []
    matches = lambda item: (item == 'null' and value is None or item == 'string' and isinstance(value, str)
        or item == 'boolean' and isinstance(value, bool)
        or item == 'integer' and isinstance(value, int) and not isinstance(value, bool)
        or item == 'number' and isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
        or item == 'object' and isinstance(value, dict) or item == 'array' and isinstance(value, list))
    if kinds and not any(matches(item) for item in kinds):
        raise ValueError(f'{field} must be a finite {kind} of its declared type.')
    if 'enum' in schema and value not in schema['enum']:
        raise ValueError(f'{field} is outside the declared choices.')
    if isinstance(value, str):
        if len(value) < schema.get('minLength', 0) or len(value) > schema.get('maxLength', float('inf')):
            raise ValueError(f'{field} has an invalid length.')
        if schema.get('pattern') and not re.search(schema['pattern'], value):
            raise ValueError(f'{field} violates the declared format.')
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if not math.isfinite(value) or value < schema.get('minimum', -math.inf) or value > schema.get('maximum', math.inf):
            raise ValueError(f'{field} is outside the declared range.')
        if 'exclusiveMinimum' in schema and value <= schema['exclusiveMinimum'] or 'exclusiveMaximum' in schema and value >= schema['exclusiveMaximum']:
            raise ValueError(f'{field} is outside the declared exclusive range.')
    if isinstance(value, list):
        if len(value) < schema.get('minItems', 0) or len(value) > schema.get('maxItems', math.inf):
            raise ValueError(f'{field} has an invalid item count.')
        for index, item in enumerate(value):
            _schema_value(item, schema.get('items', {}), f'{field}[{index}]', depth + 1)
    elif isinstance(value, dict):
        if any(not isinstance(key, str) for key in value):
            raise ValueError(f'{field} requires string JSON keys.')
        properties = schema.get('properties', {})
        if any(key not in value for key in schema.get('required', [])):
            raise ValueError(f'{field} is missing a required field.')
        for key, item in value.items():
            extra = schema.get('additionalProperties', True)
            if key not in properties and extra is False:
                raise ValueError(f'{field} has no declared {key} argument.')
            _schema_value(item, properties.get(key, extra if isinstance(extra, dict) else {}), f'{field}.{key}', depth + 1)
    elif value is not None and not isinstance(value, (str, bool, int, float)):
        raise ValueError(f'{field} must be a JSON value.')
    return value


# updatePattern (PATCH /patterns/{id}) documents a FLAT body: pattern.{name,
# ppq, bars, swing, sources, events}. Reads (and the native DTO the UI edits)
# nest the score as pattern.pattern.{version, sources, events} plus lengthTicks;
# that nested shape is undocumented for writes. The November 10 release saves
# the flat body (the old backend silently wiped it). Every path (/api/call
# adapter and /api/studio) sends the flat body built here, and a body that
# would not carry the complete score (both sources and events) is refused.
class _PatternBodyError(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


PATTERN_BODY_FIELDS = ("name", "ppq", "bars", "swing", "sources", "events")


# PatternNote documents type midi|note only, but saved drum patterns hold
# sample step hits {id, sourceId, tick, velocity, type:'sample'}, and the live
# flat updatePattern stored them unchanged (identity PATCH, project
# 859daf761ad34962 "Vegetable drums", 14 sample events, 2026-11-10T21:07Z).
# Documented note types are schema-checked; other typed events (sample hits,
# CC points) are forwarded exactly as read, never reshaped or guessed.
def _documented_note_view(body):
    events = body['pattern'].get('events')
    if not isinstance(events, list):
        return body
    notes = []
    for index, event in enumerate(events):
        if not isinstance(event, dict):
            raise _PatternBodyError('invalid_pattern_body', f'pattern.events[{index}] must be an object.')
        if event.get('type', 'midi') in ('midi', 'note'):
            notes.append(event)
    return {**body, 'pattern': {**body['pattern'], 'events': notes}}


def single_length_pattern_body(body):
    """2026-11-11: a pattern write carrying both `bars` and `lengthTicks` that
    disagree is 400 (details.expectedBars). The native engine_update_pattern
    action takes the read DTO, which carries both; like updatePattern, `bars`
    is the writable length, so lengthTicks is dropped whenever bars is present."""
    if not isinstance(body, dict) or not isinstance(body.get("pattern"), dict):
        return body
    pattern = body["pattern"]
    if "bars" not in pattern or not any(key in pattern for key in ("lengthTicks", "length_ticks")):
        return body
    return {**body, "pattern": {key: value for key, value in pattern.items() if key not in ("lengthTicks", "length_ticks")}}


def documented_pattern_body(body):
    if not isinstance(body, dict) or not isinstance(body.get("pattern"), dict):
        raise _PatternBodyError("invalid_pattern_body", "updatePattern needs a pattern object.")
    pattern = deepcopy(body["pattern"])
    nested = pattern.pop("pattern", None)
    if nested is not None:
        if not isinstance(nested, dict):
            raise _PatternBodyError("invalid_pattern_body", "The nested pattern score must be an object.")
        if "sources" in pattern or "events" in pattern:
            raise _PatternBodyError("ambiguous_pattern_body", "A pattern body cannot carry both flat and nested sources/events.")
        # Other stored score fields (version, …) are not part of the documented
        # body; the live flat PATCH kept the omitted pattern.version unchanged.
        pattern["sources"], pattern["events"] = nested.get("sources"), nested.get("events")
    # Length: the body documents whole `bars` only, and since 338 a bars change
    # also rewrites the stored lengthTicks = ppq * 4 * bars (live 2026-11-11,
    # project 859daf761ad34962: bars 1 -> 3 -> 1 read back 1152 then 384).
    # lengthTicks is never sent: `bars` is the writable length, rounded up to
    # whole bars; a body without bars takes its length from lengthTicks.
    number = lambda value: isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0
    ticks = [pattern.pop(key) for key in ("lengthTicks", "length_ticks") if key in pattern]
    ppq, bars = pattern.get("ppq"), pattern.get("bars")
    if "bars" in pattern and not number(bars):
        raise _PatternBodyError("invalid_pattern_body", "pattern.bars must be a positive number of bars (got " + repr(bars) + ").")
    if number(bars):
        pattern["bars"] = max(1, math.ceil(bars - 1e-9))
    elif number(ppq) and ticks and number(ticks[0]):
        pattern["bars"] = max(1, math.ceil(ticks[0] / (4 * ppq) - 1e-9))
    # Only the documented fields are sent. Read-only row metadata and other
    # stored fields are omitted, and omitted fields keep their stored value
    # (live: gradient, lengthTicks and pattern.version were all preserved).
    pattern = {key: pattern[key] for key in PATTERN_BODY_FIELDS if key in pattern}
    if not isinstance(pattern.get("sources"), list) or not isinstance(pattern.get("events"), list):
        raise _PatternBodyError("incomplete_pattern_body", "updatePattern must send the complete pattern.sources and pattern.events.")
    return {**{key: value for key, value in body.items() if key != "pattern"}, "pattern": pattern}


def _operation_request(operation_id, arguments, *, context_track=None, key=None, if_match=None, response_kind=None, all_pages=False):
    op = OPERATIONS[operation_id]
    args = deepcopy(arguments)
    resource_project_id = args.get('project_id')
    supplied_key = args.pop('idempotency_key', None)
    supplied_match = args.pop('if_match', None)
    # Header-only revisions are explicit; an expected_revision JSON field keeps
    # its endpoint-specific semantics and is never silently converted.
    if key is None:
        key = supplied_key
    if if_match is None:
        if_match = supplied_match
    path, path_params, query, body = op['path'], {}, {}, {}
    body_schema = op['body']
    properties = body_schema.get('properties', {})
    if 'idempotency_key' in properties and supplied_key is not None:
        args['idempotency_key'] = supplied_key
    if context_track is not None and any(p['in'] == 'query' and p['name'] == 'scope_track_id' for p in op['parameters']):
        _opaque(context_track, 'scope_track_id')
        if 'scope_track_id' in args and args['scope_track_id'] != context_track:
            raise ValueError('Conflicting live session scope_track_id.')
        args['scope_track_id'] = context_track
    if context_track is not None and not any(p['name'] == 'scope_track_id' and p['in'] == 'query' for p in op['parameters']) and ('track_id' in properties or any(p['in'] == 'query' and p['name'] == 'track_id' for p in op['parameters'])):
        if 'track_id' in args:
            raise ValueError('A target lane track_id cannot replace the engine context track_id.')
        args['track_id'] = context_track
    for parameter in op['parameters']:
        name, location = parameter['name'], parameter['in']
        if location == 'header':
            continue
        if name not in args:
            if parameter.get('required'):
                raise ValueError(f'{operation_id} requires {name}.')
            continue
        value = args.pop(name)
        _schema_value(value, parameter.get('schema', {}), name)
        if location == 'path':
            if name in ('plugin_index', 'parameter_index', 'index'):
                if not isinstance(value, int) or isinstance(value, bool) or value < 0:
                    raise ValueError(f'{name} must be a nonnegative integer.')
            else:
                _opaque(value, name)
            path_params[name] = value
            if name in properties:
                body[name] = deepcopy(value)
            path = path.replace('{' + name + '}', quote(str(value), safe=''))
        elif location == 'query':
            query[name] = value
    for name, value in list(args.items()):
        if name not in properties:
            raise ValueError(f'{operation_id} has no declared {name} argument.')
        if not (operation_id == 'updatePattern' and name == 'pattern'):  # validated below, after the flat conversion
            _schema_value(value, properties[name], name)
        body[name] = value
    missing = [name for name in body_schema.get('required', []) if name not in body]
    if missing:
        raise ValueError(f'{operation_id} requires {", ".join(missing)}.')
    if '{' in path:
        raise ValueError(f'{operation_id} has an unresolved resource path.')
    headers = {}
    if operation_id in RETAINED_KEY_OPERATIONS and key is None:
        raise ValueError(f'{operation_id} requires a caller-retained Idempotency-Key.')
    if operation_id in IF_MATCH_OPERATIONS and if_match is None:
        raise ValueError(f'{operation_id} requires a fresh timeline If-Match revision.')
    if op['method'] not in ('GET', 'HEAD', 'OPTIONS'):
        key = str(uuid4()) if key is None else key
        if not isinstance(key, str) or not 8 <= len(key) <= 128 or '\r' in key or '\n' in key:
            raise ValueError('Idempotency-Key must be 8–128 safe characters.')
        headers['Idempotency-Key'] = key
    if operation_id == 'updatePattern' and 'pattern' in body:
        body = documented_pattern_body(body)
        _schema_value(_documented_note_view(body), body_schema, operation_id + ' body')
    elif operation_id == 'engine_update_pattern':
        body = single_length_pattern_body(body)
        _schema_value(body, body_schema, operation_id + ' body')
    else:
        _schema_value(body, body_schema, operation_id + ' body')
    if if_match is not None:
        if not isinstance(if_match, str) or not if_match or '\r' in if_match or '\n' in if_match:
            raise ValueError('If-Match must be a nonempty safe ETag.')
        headers['If-Match'] = if_match
    return {'kind': 'request', 'operationId': operation_id, 'method': op['method'], 'path': '/api/v1' + path,
            'pathParams': path_params, 'query': query, 'body': body if op['bodyRequired'] or body else None, 'headers': headers,
            'responseKind': response_kind or LIST_COLLECTIONS.get(operation_id, 'raw'), 'allPages': bool(all_pages), 'resourceProjectId': resource_project_id, 'idempotencyKey': headers.get('Idempotency-Key'), 'ifMatch': headers.get('If-Match')}


def _target_alias(args, old, new):
    if old not in args:
        return
    if new in args and args[new] != args[old]:
        raise ValueError(f'Conflicting {old} and {new} resource identities.')
    args[new] = args.pop(old)


def _native_action_args(action, nested, operation_id=None):
    args = deepcopy(nested)
    # Create and PATCH placement windowMs are published as integer-or-null:
    # null explicitly clears the trim window (Trim Undo), omission keeps it.
    # Forward an explicit null unchanged; never strip or invent it.
    if action in LANE_TARGET_ACTIONS and not (operation_id or '').startswith('engine_'):
        _target_alias(args, 'track_id', 'lane_id')
    if action == 'rename_track' and operation_id == 'updateLane':
        _target_alias(args, 'label', 'name')
    if action == 'attach_clip_to_session':
        _target_alias(args, 'db_track_id', 'clip_id')
    if action == 'add_lane_plugin' and operation_id == 'addLanePlugin':
        _target_alias(args, 'type', 'plugin_id')
    if (operation_id or '').startswith('engine_'):
        for field in ('track_id', 'clip_id', 'lane_id', 'bus_id', 'pattern_id', 'placement_id', 'instrument_id', 'source_id'):
            if field in args:
                _opaque(args[field], field)
    return args


def _batch_action(action, nested, outer, key=None, if_match=None):
    args = deepcopy(nested)
    clip_id = args.pop('clip_id', None)
    if clip_id is None:
        raise UnmappedStudioCall('execute_pro_action', action, 'A durable clip_id is required; a lane or runtime index cannot identify an audio clip.')
    _opaque(clip_id, 'clip_id')
    # Legacy audioIdentity includes the durable source lane, independently of
    # the outer take used to resolve the running session.
    lane_id = args.pop('track_id', None)
    if lane_id is not None:
        _opaque(lane_id, 'track_id')
    permitted = {'shift_clip': {'start_ms'}, 'trim_clip': {'start_ms', 'duration_sec', 'audio_offset_sec'}, 'delete_clip': set()}[action]
    if not set(args).issubset(permitted | {'expected'}):
        raise UnmappedStudioCall('execute_pro_action', action, 'The legacy clip action contains fields outside the declared timing batch contract.')
    if action != 'delete_clip' and not permitted.intersection(args):
        raise ValueError(f'{action} needs at least one timing value.')
    if 'expected' in args:
        expected = args['expected']
        timing = {'start_ms', 'duration_sec', 'audio_offset_sec'}
        if not isinstance(expected, dict) or set(expected) != timing:
            raise ValueError('A clip batch expected guard needs exactly start_ms, duration_sec and audio_offset_sec.')
    operation = {'op': 'remove' if action == 'delete_clip' else 'update', 'id': clip_id, **args}
    request = {'project_id': outer['project_id'], 'ops': [operation]}
    if outer.get('track_id') is not None:
        request['track_id'] = outer['track_id']
    return _operation_request('applyClipBatch', request, key=key, if_match=if_match)


def capability(action):
    """Local complete schema generated from a known REST operation, never MCP."""
    operation_id = PRO_ACTIONS.get(action)
    if not operation_id:
        raise UnmappedStudioCall('list_pro_capabilities', action, KNOWN_GAPS.get(action))
    operation = OPERATIONS[operation_id]
    schema = deepcopy(operation['body']) or {'type': 'object', 'properties': {}}
    schema.setdefault('properties', {})
    schema.setdefault('required', [])
    native_action = operation_id.startswith('engine_')
    if not native_action:
        schema['properties'].pop('track_id', None)  # resource route's optional session context
        schema['required'] = [k for k in schema['required'] if k != 'track_id']
    for parameter in operation['parameters']:
        if parameter['in'] == 'header' or parameter['name'] == 'project_id':
            continue
        name = parameter['name']
        if name in ('track_id', 'scope_track_id', 'confirm'):
            continue
        if name == 'lane_id' and action in LANE_TARGET_ACTIONS:
            name = 'track_id'
        schema['properties'][name] = deepcopy(parameter.get('schema', {}))
        if parameter.get('required'):
            schema['required'].append(name)
    if action == 'rename_track':
        schema['properties']['label'] = schema['properties'].pop('name')
        schema['required'] = ['label' if k == 'name' else k for k in schema['required']]
    if action == 'attach_clip_to_session':
        schema['properties']['db_track_id'] = schema['properties'].pop('clip_id')
        schema['required'] = ['db_track_id' if k == 'clip_id' else k for k in schema['required']]
    for field, unit in {'gain': 'linear (1 = unity)', 'pan': '-1 hard left, 0 center, 1 hard right', 'value_norm': 'normalized 0–1'}.items():
        if field in schema['properties']:
            schema['properties'][field]['x-unit'] = unit
    schema['additionalProperties'] = False
    schema['required'] = list(dict.fromkeys(schema['required']))
    # Some published engine read operations use POST; their scope/role and
    # exact engine summary establish read semantics rather than the verb.
    mutates = operation.get('scope') not in ('daw:read',) if native_action else operation['method'] not in ('GET', 'HEAD', 'OPTIONS')
    return {'name': action, 'argumentSchema': schema, 'method': operation['method'], 'mutates': mutates,
            'family': 'studio', 'risk': 'reversible' if mutates else 'read', 'destructive': operation['method'] == 'DELETE' or operation.get('confirmation') == 'confirm=true',
            'requiresConfirmation': operation.get('confirmation') == 'confirm=true', 'result': 'Studio API v1 operation ' + operation_id, 'apiSurface': 'studio-v1'}


def plan_call(name, arguments=None, *, idempotency_key=None, if_match=None):
    args = deepcopy(arguments or {})
    if not isinstance(args, dict):
        raise TypeError('Studio API arguments must be an object.')
    if name in AI_ONLY_TOOLS:
        return {'kind': 'mcp', 'name': name, 'arguments': args, 'reason': 'AI-assistant feature'}
    if name == 'list_pro_capabilities':
        if args.get('action'):
            return {'kind': 'local', 'result': capability(args['action'])}
        return {'kind': 'local', 'result': {'capabilities': [capability(action) for action in sorted(PRO_ACTIONS)], 'capabilityCount': len(PRO_ACTIONS), 'apiSurface': 'studio-v1'}}
    if name == 'get_pro_state':
        project_id = args.get('project_id')
        _opaque(project_id, 'project_id')
        if set(args) - {'project_id', 'track_id'}:
            raise ValueError('get_pro_state accepts only project_id and optional track_id.')
        return {'kind': 'aggregate', 'project_id': project_id, 'track_id': args.get('track_id'), 'responseKind': 'pro_state',
                'requests': {'project': _operation_request('getProject', {'project_id': project_id}),
                    **{key: _operation_request(operation, {'project_id': project_id}, all_pages=True)
                       for key, operation in {'lanes': 'listLanes', 'clips': 'listClips', 'patterns': 'listPatterns', 'placements': 'listPatternPlacements', 'buses': 'listBuses'}.items()},
                    'engine': _operation_request('getEngineState', {'project_id': project_id}, context_track=args.get('track_id'))}}
    if name == 'execute_pro_action':
        action = args.get('action')
        nested = args.get('arguments', {})
        if not isinstance(action, str) or not isinstance(nested, dict):
            raise ValueError('An engine action needs its explicit action name and object arguments.')
        if action in AI_ONLY_ACTIONS:
            return {'kind': 'mcp', 'name': name, 'arguments': args, 'reason': 'AI-assistant feature'}
        if action in ('shift_clip', 'trim_clip', 'delete_clip'):
            return _batch_action(action, nested, args, idempotency_key, if_match)
        operation_id = PRO_ACTIONS.get(action)
        if not operation_id:
            raise UnmappedStudioCall(name, action, KNOWN_GAPS.get(action))
        if action == 'move_clip_to_lane' and isinstance(nested.get('start_ms'), (int, float)) and not isinstance(nested.get('start_ms'), bool) and math.isfinite(nested['start_ms']) and not float(nested['start_ms']).is_integer():
            operation_id = 'engine_move_clip_to_lane'
        if action == 'load_bus_plugin':
            operation_id = 'addBusPlugin' if 'plugin_id' in nested else 'engine_load_bus_plugin'
        if action == 'add_instrument_track' and 'instrument_id' in nested:
            operation_id = 'createInstrumentLane'
        target = _native_action_args(action, nested, operation_id)
        if action == 'finalize_recording':
            target.setdefault('confirm', args.get('confirmed_destructive') is True)
        target['project_id'] = args.get('project_id')
        operation = OPERATIONS[operation_id]
        if operation.get('confirmation') == 'confirm=true' and args.get('confirmed_destructive') is True:
            target.setdefault('confirm', True)
        if action == 'set_bus_gain' and target.get('bus_id') == 'master':
            operation_id = 'setMasterGain'
            target.pop('bus_id')
        return _operation_request(operation_id, target, context_track=args.get('track_id'), key=idempotency_key,
                                  if_match=if_match, response_kind='tracks_live' if action == 'list_tracks' else None,
                                  all_pages=action in ('list_patterns', 'list_pattern_placements'))
    if name == 'transport_control':
        command = args.pop('command', None)
        if command == 'stop':
            project_id = args.get('project_id')
            return {'kind': 'sequence', 'responseKind': 'transport', 'command': command, 'project_id': project_id,
                    'requests': [_operation_request('pause', args), _operation_request('seek', {**args, 'seconds': 0, 'play': False})]}
        operation_id = {'status': 'getTransport', 'play': 'play', 'pause': 'pause', 'seek': 'seek', 'seek_and_play': 'seek', 'play_range': 'playRange'}.get(command)
        if not operation_id:
            raise UnmappedStudioCall(name, command, 'No Studio API transport command matches this request.')
        if command == 'seek_and_play':
            args['play'] = True
        request = _operation_request(operation_id, args, key=idempotency_key, if_match=if_match, response_kind='transport')
        request.update({'command': command, 'project_id': arguments.get('project_id')})
        return request
    if name == 'get_saved_plugin_state':
        if args.get('lane_id'):
            operation_id = 'getSavedLanePluginState'
            args.pop('track_id', None)  # old named tool treats it as clip target, not engine context
        else:
            operation_id = 'getSavedClipPluginState'
            _target_alias(args, 'track_id', 'clip_id')
    elif name == 'list_automation' and args.get('clip_ids') is not None:
        clip_ids = args.pop('clip_ids')
        if not isinstance(clip_ids, list) or not clip_ids:
            raise ValueError('clip_ids must be a nonempty list of durable clip identities.')
        return {'kind': 'merge_list', 'responseKind': 'envelopes', 'requests': [_operation_request('listClipAutomation', {**args, 'clip_id': clip_id}, all_pages=True) for clip_id in clip_ids]}
    else:
        operation_id = DIRECT_TOOLS.get(name)
    if not operation_id:
        raise UnmappedStudioCall(name, reason=KNOWN_GAPS.get(name))
    if name in ('browse_sounds', 'browse_marketplace', 'list_preset_pack_items', 'list_effect_presets', 'list_vocal_chain_presets'):
        _target_alias(args, 'search', 'q')
    if name in ('create_automation', 'update_automation', 'delete_automation'):
        for old, new in AUTOMATION_KEYS.items():
            _target_alias(args, old, new)
    request = _operation_request(operation_id, args, key=idempotency_key, if_match=if_match,
                                 all_pages=name in ('list_buses', 'list_automation'))
    if name == 'get_project':
        return {'kind': 'project', 'request': request, 'responseKind': 'project_complete'}
    return request


def transport_payload(request):
    """Exact StudioApiTransport.call payload (path is its parameter object)."""
    if request.get('kind') != 'request' or request.get('operationId') not in OPERATIONS:
        raise ValueError('Only an explicit REST request can be sent to the transport.')
    result = {'operationId': request['operationId'], 'path': deepcopy(request['pathParams']),
              'query': deepcopy(request['query']), 'body': deepcopy(request['body'])}
    for name in ('idempotencyKey', 'ifMatch'):
        if request.get(name) is not None:
            result[name] = request[name]
    return result


def request_url(request, origin='https://freestyle.audio'):
    """Build a URL only for a plan produced by this explicit registry."""
    if request.get('operationId') not in OPERATIONS or not request.get('path', '').startswith('/api/v1/'):
        raise ValueError('A known Studio API request is required.')
    template = '/api/v1' + OPERATIONS[request['operationId']]['path']
    pattern = re.sub(r'\\\{[^}]+\\\}', r'[^/]+', re.escape(template))
    if not re.fullmatch(pattern, request['path']) or request.get('method') != OPERATIONS[request['operationId']]['method']:
        raise ValueError('The request does not match its declared operation path and method.')
    query = {key: ('true' if value else 'false') if isinstance(value, bool) else value for key, value in request.get('query', {}).items()}
    return origin.rstrip('/') + request['path'] + ('?' + urlencode(query, doseq=True) if query else '')


class StudioSnapshotConflict(ValueError):
    status = 409
    code = 'studio_api_snapshot_conflict'
    stage = 'canonical_read'


def _payload(response):
    if isinstance(response, tuple) and len(response) == 2:
        return response[0]
    if isinstance(response, dict) and isinstance(response.get('status'), int) and isinstance(response.get('headers'), dict) and 'data' in response:
        return response['data']
    return response


def _response_headers(response):
    if isinstance(response, tuple) and len(response) == 2:
        return response[1] or {}
    if isinstance(response, dict) and isinstance(response.get('status'), int) and isinstance(response.get('headers'), dict) and 'data' in response:
        return response['headers']
    return {}


def _etag(headers):
    return next((value for key, value in headers.items() if key.lower() == 'etag'), None)


class StudioAPIResponseError(RuntimeError):
    """Preserve a transport-returned real HTTP failure without replaying it."""
    def __init__(self, response):
        self.status = response['status']
        body = response.get('data')
        error = body.get('error') if isinstance(body, dict) else None
        error = error if isinstance(error, dict) else {}
        self.code = error.get('code', 'studio_api_http_error')
        self.stage = error.get('stage', 'response')
        self.engineStatus = error.get('engineStatus')
        self.details = deepcopy(error.get('details'))
        self.requestId = error.get('requestId') or next((value for key, value in _response_headers(response).items() if key.lower() == 'x-request-id'), None)
        # A refused-before-applied 503 (engine_session_*, render_busy) names its
        # wait in Retry-After: keep it (bounded seconds) so the UI can say when.
        retry = next((value for key, value in _response_headers(response).items() if key.lower() == 'retry-after'), None)
        self.retryAfterSec = float(retry) if isinstance(retry, str) and re.fullmatch(r'\s*\d+(?:\.\d+)?\s*', retry) else None
        super().__init__(error.get('message', f'Studio API returned HTTP {self.status}.'))


def _with_metadata(request, response):
    if isinstance(response, dict) and isinstance(response.get('status'), int) and 'headers' in response and 'data' in response and not 200 <= response['status'] < 300:
        raise StudioAPIResponseError(response)
    data = deepcopy(_payload(response))
    if data is None and isinstance(response, dict) and 200 <= response.get('status', 0) < 300:
        data = {'ok': True}
    if not isinstance(data, dict):
        raise ValueError('Studio API returned no object response.')
    data['_studioApi'] = {'etag': _etag(_response_headers(response)), 'projectId': request.get('resourceProjectId'),
                          'operationId': request.get('operationId')}
    return data


def _consistent(expected, observed):
    if expected is not None and expected != observed:
        raise StudioSnapshotConflict('The project changed while its REST snapshot was loading. Read a fresh snapshot before editing.')


def _snapshot_etag(results):
    etags = [value.get('_studioApi', {}).get('etag') for value in results if isinstance(value, dict)]
    known = [etag for etag in etags if etag is not None]
    if known and len(known) != len(etags):
        raise StudioSnapshotConflict('A canonical REST page omitted its ETag; a consistent snapshot cannot be established.')
    if known:
        for observed in known:
            _consistent(known[0], observed)
    return known[0] if known else None


def _engine_payload(value):
    return value.get('response', value) if isinstance(value, dict) else value


def _page(request, send):
    first = _with_metadata(request, _send(deepcopy(request), send))
    if not request.get('allPages'):
        return first
    if not isinstance(first, dict) or not isinstance(first.get('data'), list):
        raise ValueError(f"{request['operationId']} did not return its declared data page.")
    result, rows, seen = deepcopy(first), list(first['data']), set()
    pagination = first.get('pagination')
    for _ in range(1000):
        if not isinstance(pagination, dict) or not isinstance(pagination.get('hasMore'), bool):
            raise ValueError('Read a complete cursor page before editing canonical data.')
        if not pagination['hasMore']:
            if pagination.get('nextCursor') is not None:
                raise ValueError('Freestyle returned conflicting cursor completion metadata.')
            result['data'] = rows
            result['pagination'] = {**pagination, 'hasMore': False, 'nextCursor': None}
            result['total'] = len(rows)
            return result
        cursor = pagination.get('nextCursor')
        if not isinstance(cursor, str) or not cursor or cursor in seen:
            raise ValueError('Freestyle returned an invalid or repeated canonical page cursor.')
        seen.add(cursor)
        follow = deepcopy(request)
        follow['query']['cursor'] = cursor
        data = _with_metadata(follow, _send(follow, send))
        _consistent(first.get('_studioApi', {}).get('etag'), data.get('_studioApi', {}).get('etag'))
        if not isinstance(data, dict) or not isinstance(data.get('data'), list):
            raise ValueError('Freestyle returned an incomplete canonical data page.')
        rows.extend(data['data'])
        pagination = data.get('pagination')
    raise ValueError('Canonical pagination exceeded its bounded read budget.')


def _live_collection(value, collection):
    """Annotate only genuine successful native collections; never synthesize IDs."""
    native = deepcopy(value) if isinstance(value, dict) else {'unavailable': 'No native collection returned.'}
    rows = native.get(collection)
    if native.get('ok') is False or native.get('unavailable') or native.get('error') or not isinstance(rows, list):
        return {**native, 'live': False, 'runtime_ids_available': False, 'source': 'studio-v1-engine-state'}
    if collection == 'tracks':
        identifiers = [row.get('id') for row in rows if isinstance(row, dict)]
        if len(identifiers) != len(rows) or any(not isinstance(identity, int) or isinstance(identity, bool) or identity < 0 for identity in identifiers) or len(set(identifiers)) != len(identifiers):
            raise StudioSnapshotConflict('The native engine track read has ambiguous runtime IDs.')
    return {**native, 'live': True, 'runtime_ids_available': collection == 'tracks', 'source': 'studio-v1-engine-state'}


def adapt_response(request, payload):
    """Expose known old DTO keys, preserving actual server values unchanged."""
    kind = request.get('responseKind', 'raw')
    if kind == 'transport':
        native = _engine_payload(payload)
        if not isinstance(native, dict):
            raise ValueError('Studio transport returned no status object.')
        status = deepcopy(native['status'] if isinstance(native.get('status'), dict) else native)
        status.pop('_studioApi', None)
        return {'project_id': request.get('project_id') or request.get('resourceProjectId'), 'command': request.get('command'), 'status': status, **({'_studioApi': deepcopy(payload['_studioApi'])} if isinstance(payload, dict) and '_studioApi' in payload else {})}
    if kind == 'tracks_live':
        return _live_collection(_engine_payload(payload), 'tracks')
    if kind == 'tracks_saved':
        if not isinstance(payload, dict) or not isinstance(payload.get('data'), list):
            raise ValueError('Studio lanes returned no declared data page.')
        # Saved lane values are useful but are NOT numeric live track bindings.
        # Existing callers must choose the v1 durable-lane control contract.
        rows = []
        for lane in payload['data']:
            rows.append({'db_track_id': lane['id'], 'label': lane.get('name'), 'kind': lane.get('kind'),
                         **({'gain': lane['volume']} if 'volume' in lane else {}),
                         **({'pan': lane['pan']} if 'pan' in lane else {}),
                         **({'muted': lane['muted']} if 'muted' in lane else {}),
                         **({'soloed': lane['solo']} if 'solo' in lane else {}),
                         **({'bus_id': lane['busId']} if 'busId' in lane else {})})
        return {'ok': True, 'tracks': rows, 'live': False, 'runtime_ids_available': False, 'source': 'studio-v1-persisted-lanes', **({'_studioApi': deepcopy(payload['_studioApi'])} if '_studioApi' in payload else {})}
    if kind in set(LIST_COLLECTIONS.values()) and isinstance(payload, dict) and isinstance(payload.get('data'), list):
        pagination = deepcopy(payload.get('pagination', {}))
        result = {'ok': True, kind: deepcopy(payload['data']), 'pagination': pagination}
        if 'nextCursor' in pagination:
            result['nextCursor'] = pagination['nextCursor']
        if 'total' in payload:
            result['total'] = payload['total']
        if '_studioApi' in payload:
            result['_studioApi'] = deepcopy(payload['_studioApi'])
        return result
    return deepcopy(payload)


def _rows(response, collection):
    if not isinstance(response, dict) or not isinstance(response.get(collection), list):
        raise ValueError(f'Freestyle returned no complete {collection} collection.')
    return response[collection]


def _complete_patterns(rows, project_id, send, expected_etag=None):
    result = []
    for row in rows:
        content = row.get('data', row) if isinstance(row, dict) else None
        pattern = content.get('pattern') if isinstance(content, dict) else None
        if not isinstance(pattern, dict) or not isinstance(pattern.get('sources'), list) or not isinstance(pattern.get('events'), list):
            if not isinstance(row, dict) or not isinstance(row.get('id'), str):
                raise ValueError('The canonical pattern list contains no durable identity.')
            request = _operation_request('getPattern', {'project_id': project_id, 'pattern_id': row['id']})
            detail = _page(request, send)
            _consistent(expected_etag, detail.get('_studioApi', {}).get('etag'))
            content = _engine_payload(detail)
            if isinstance(content, dict) and isinstance(content.get('pattern'), dict) and 'id' in content['pattern']:
                content = content['pattern']
            pattern = content.get('pattern') if isinstance(content, dict) else None
            if not isinstance(content, dict) or content.get('id') != row['id'] or not isinstance(pattern, dict) or not isinstance(pattern.get('sources'), list) or not isinstance(pattern.get('events'), list):
                raise UnmappedStudioCall('get_pro_state', reason='Studio getPattern did not return complete canonical sources/events; editing the summary would lose notes.')
        if content.get('projectId', project_id) != project_id:
            raise ValueError('Freestyle returned a canonical pattern from another project.')
        content = deepcopy(content)
        content.pop('_studioApi', None)
        result.append(content)
    return result


def _complete_placements(rows, project_id, send, expected_etag=None):
    result, required = [], {'offsetMs', 'loopPhaseMs', 'loopDurationMs', 'repeatCount', 'durationMs', 'startMs', 'windowMs', 'sourceBusOverrides'}
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get('id'), str):
            raise ValueError('The placement list has no durable identity.')
        expected_id = row['id']
        if not required.issubset(row):
            detail = _page(_operation_request('getPatternPlacement', {'project_id': project_id, 'placement_id': row['id']}), send)
            _consistent(expected_etag, detail.get('_studioApi', {}).get('etag'))
            row = _engine_payload(detail)
            if isinstance(row, dict) and isinstance(row.get('placement'), dict):
                row = row['placement']
            if not isinstance(row, dict) or row.get('id') != expected_id or not required.issubset(row):
                raise UnmappedStudioCall('get_pro_state', reason='Studio placement detail lacks canonical phase, offset or routing; editing its summary is unsafe.')
        if row.get('projectId', project_id) != project_id:
            raise ValueError('Freestyle returned a placement from another project.')
        row = deepcopy(row)
        row.pop('_studioApi', None)
        result.append(row)
    return result


def execute_plan(plan, send):
    """Execute with send(request_dict)->{status, headers, data, idempotencyKey}.

    Plain JSON or (JSON, headers) callbacks remain useful for offline tests.

    No mutation retry or MCP transport exists here. The HTTP callback retains
    ETags and propagates the real HTTP error/412 unchanged. Composites contain
    only explicitly declared reads or the documented Pause + Seek stop recipe.
    """
    kind = plan.get('kind')
    if kind == 'local':
        return deepcopy(plan['result'])
    if kind == 'mcp':
        raise ValueError('AI-only MCP plans belong to the caller; no MCP transport is available in this adapter.')
    if kind == 'request':
        raw = _page(plan, send)
        if plan.get('responseKind') in ('patterns', 'placements') and plan.get('allPages'):
            project_id = next((value for key, value in plan.get('query', {}).items() if key == 'project_id'), None)
            # The project path was already validated by the operation builder.
            project_id = plan.get('resourceProjectId', project_id)
            if project_id:
                raw['data'] = (_complete_patterns if plan['responseKind'] == 'patterns' else _complete_placements)(raw['data'], project_id, send, raw.get('_studioApi', {}).get('etag'))
        return adapt_response(plan, raw)
    if kind == 'sequence':
        last = None
        for request in plan['requests']:
            last = execute_plan(request, send)
        return adapt_response(plan, last)
    if kind == 'merge_list':
        rows = []
        for request in plan['requests']:
            rows.extend(_rows(execute_plan(request, send), plan['responseKind']))
        return {'ok': True, plan['responseKind']: rows, 'nextCursor': None}
    if kind == 'project':
        # getProject and the four collections are independent reads of one
        # validated project id, so they run as ONE parallel phase (as the
        # aggregate snapshot already does). Every page must still carry the
        # same ETag as getProject, so the snapshot stays a single revision.
        project_id = plan['request'].get('resourceProjectId')
        _opaque(project_id, 'project_id')
        requests = {'project': plan['request'], **{collection: _operation_request(operation_id, {'project_id': project_id}, all_pages=True) for collection, operation_id in {'lanes': 'listLanes', 'clips': 'listClips', 'patterns': 'listPatterns', 'placements': 'listPatternPlacements'}.items()}}
        pages = _parallel_reads(requests, send)
        project = pages.pop('project')
        if not isinstance(project, dict) or project.get('id') != project_id:
            raise ValueError('Studio getProject returned no project identity.')
        expected_etag = project.get('_studioApi', {}).get('etag')
        for collection, page in pages.items():
            _consistent(expected_etag, page.get('_studioApi', {}).get('etag'))
            rows = _rows(page, collection)
            if collection == 'patterns':
                rows = _complete_patterns(rows, project_id, send, expected_etag)
            elif collection == 'placements':
                rows = _complete_placements(rows, project_id, send, expected_etag)
            project[collection] = rows
        project['truncated'] = {**project.get('truncated', {}), **{name: False for name in ('lanes', 'clips', 'patterns', 'placements')}}
        return project
    if kind == 'aggregate':
        data = _parallel_reads(plan['requests'], send)
        project_id = plan['project_id']
        expected_etag = _snapshot_etag([data[key] for key in ('project', 'lanes', 'clips', 'patterns', 'placements')])
        if not isinstance(data['project'], dict) or data['project'].get('id') != project_id:
            raise ValueError('Studio state belongs to another project.')
        lanes, clips = _rows(data['lanes'], 'lanes'), _rows(data['clips'], 'clips')
        patterns = _complete_patterns(_rows(data['patterns'], 'patterns'), project_id, send, expected_etag)
        placements = _complete_placements(_rows(data['placements'], 'placements'), project_id, send, expected_etag)
        buses = _rows(data['buses'], 'buses')
        engine = _engine_payload(data['engine'])
        if not isinstance(engine, dict) or engine.get('projectId') != project_id:
            raise StudioSnapshotConflict('The live engine state belongs to another project. Read a fresh session before continuing.')
        transport = deepcopy(engine.get('transport'))
        if not isinstance(transport, dict) or transport.get('unavailable') or transport.get('ok') is False or not isinstance(transport.get('is_playing'), bool) or not isinstance(transport.get('position_seconds'), (int, float)) or isinstance(transport.get('position_seconds'), bool) or not math.isfinite(transport['position_seconds']) or transport['position_seconds'] < 0:
            raise StudioSnapshotConflict('The coherent engine read did not return authoritative transport state.')
        for value in (engine.get('session'), transport, engine.get('tracks'), engine.get('clips'), engine.get('buses')):
            if isinstance(value, dict) and any(value[key] != project_id for key in ('projectId', 'project_id') if key in value):
                raise StudioSnapshotConflict('A live engine subread belongs to another project.')
        epochs = [value['session_epoch'] for value in (transport, engine.get('tracks'), engine.get('clips'), engine.get('buses')) if isinstance(value, dict) and value.get('session_epoch') is not None]
        if epochs and any(epoch != epochs[0] for epoch in epochs):
            raise StudioSnapshotConflict('The coherent engine state contains conflicting session epochs.')
        live_tracks = _live_collection(engine.get('tracks'), 'tracks')
        live_buses = _live_collection(engine.get('buses'), 'buses')
        live_clips = _live_collection(engine.get('clips'), 'clips')
        canonical_project = {**data['project'], 'lanes': lanes, 'clips': clips, 'patterns': patterns, 'placements': placements,
            'truncated': {**data['project'].get('truncated', {}), **{key: False for key in ('lanes', 'clips', 'patterns', 'placements')}}}
        return {**deepcopy(engine), 'apiSurface': 'studio-v1', 'studioApi': True,
                '_studioApi': {'etag': expected_etag, 'projectId': project_id, 'operationId': 'getEngineStateCanonical'},
                'project': canonical_project, 'transport': transport,
                'patterns': {'ok': True, 'patterns': patterns}, 'patternPlacements': {'ok': True, 'placements': placements},
                'tracks': live_tracks, 'clips': live_clips, 'buses': live_buses,
                'persistedLanes': lanes, 'persistedBuses': buses,
                'nativeMixerStateAvailable': live_tracks.get('live') is True and live_buses.get('live') is True}
    raise ValueError('Unknown Studio API adapter plan kind.')


class StudioAPIAdapter:
    """Small injectable facade for the local bridge."""
    operations = OPERATIONS
    def plan_call(self, name, arguments=None, **options):
        return plan_call(name, arguments, **options)
    def execute(self, name, arguments, send, **options):
        return execute_plan(self.plan_call(name, arguments, **options), send)
    def capability(self, action):
        return capability(action)
