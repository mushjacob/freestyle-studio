"""Local UI command schemas derived from the published Studio OpenAPI.

Compatibility command names never select an outbound MCP transport. Only the
explicit AI assistant descriptors retain MCP; DAW requests use Studio REST or
its documented read-only realtime channel.
"""
from copy import deepcopy

# API305 move renamed clips; the 308-era deployment was retested live on
# 2026-11-09 (forward + inverse preserved clip.name/window/gain/automation and
# native source). The exact
# published dedicated route is still required below.
CROSS_TRACK_PASTE_ROLLOUT = True

AI_NAMES = {'mozart_ai_command', 'mozart_ai_chat_history', 'get_mozart_ai_job', 'undo_last_ai_action'}


def resolve_schema(spec, value, ancestors=()):
    if isinstance(value, list):
        return [resolve_schema(spec, item, ancestors) for item in value]
    if not isinstance(value, dict):
        return value
    if '$ref' in value:
        ref = value['$ref']
        if not isinstance(ref, str) or not ref.startswith('#/') or ref in ancestors:
            return deepcopy(value)
        target = spec
        for part in ref[2:].split('/'):
            target = target[part.replace('~1', '/').replace('~0', '~')]
        return resolve_schema(spec, {**target, **{k: v for k, v in value.items() if k != '$ref'}}, ancestors + (ref,))
    return {key: resolve_schema(spec, child, ancestors) for key, child in value.items()}


def studio_tools(adapter, ai_descriptors=()):
    spec, result = adapter.spec, []
    aliases = {**adapter.aliases}
    native_rest = adapter.operations.get('getEngineState')
    if native_rest and str(native_rest[0]).upper() == 'GET' and native_rest[1] == '/projects/{project_id}/engine/state':
        aliases['get_pro_state'] = 'getEngineState'
    for name, op_id in sorted(aliases.items()):
        if name in AI_NAMES or op_id in {'mozartAiCommand', 'getMozartAiJob', 'undoLastAiAction'}:
            continue
        if op_id not in adapter.operations:
            continue
        method, path, operation = adapter.operations[op_id]
        body = resolve_schema(spec, operation.get('requestBody', {}).get('content', {}).get('application/json', {}).get('schema', {}))
        properties, required = deepcopy(body.get('properties', {})), list(body.get('required', []))
        for param in operation.get('parameters', []):
            parameter = resolve_schema(spec, param)
            key, where = parameter['name'], parameter['in']
            if where == 'header':
                continue
            properties[key] = deepcopy(parameter.get('schema', {}))
            if parameter.get('required'):
                required.append(key)
        properties['idempotency_key'] = {'type': 'string', 'minLength': 8, 'maxLength': 128, 'description': 'Retained identity for this user operation; sent as Idempotency-Key.'}
        properties['if_match'] = {'type': 'string', 'description': 'Captured resource ETag; a stale edit returns HTTP 412.'}
        # The local controller uses snake-case names; the adapter maps them to
        # the documented JSON names before the generated client validates them.
        if name in {'create_automation', 'update_automation', 'delete_automation'}:
            for wire, local in [('defaultValue', 'default_value'), ('valueType', 'value_type')]:
                if wire in properties:
                    properties[local] = deepcopy(properties[wire])
        result.append({'name': name, 'title': operation.get('summary', name),
            'description': operation.get('description', ''),
            'inputSchema': {'type': 'object', 'properties': properties, 'required': list(dict.fromkeys(required)), 'additionalProperties': False},
            'annotations': {'readOnlyHint': method == 'get', 'destructiveHint': method == 'delete', 'idempotentHint': method == 'get'},
            'schemaSource': 'studio-openapi', 'operationId': op_id, 'transport': 'studio-api-v1',
            'parameters': deepcopy(operation.get('parameters', []))})
    if not any(tool['name'] == 'get_pro_state' for tool in result):
        result.append({'name': 'get_pro_state', 'title': 'Read native session snapshot', 'description': 'Authoritative native tracks, clips, readiness and transport through a REST-ticket-backed read-only realtime session.', 'schemaSource': 'studio-openapi-realtime', 'transport': 'studio-api-v1', 'inputSchema': {'type': 'object', 'properties': {'project_id': {'type': 'string'}, 'track_id': {'type': 'string'}}, 'required': ['project_id']}, 'annotations': {'readOnlyHint': True}})
    for tool in ai_descriptors:
        if tool.get('name') in AI_NAMES:
            result.append({**deepcopy(tool), 'schemaSource': 'mcp-ai', 'transport': 'mcp-ai'})
    return result


def studio_features(adapter):
    native_method, native_path, _ = adapter.operations.get('getEngineState', (None, None, {}))
    native_rest = str(native_method).upper() == 'GET' and native_path == '/projects/{project_id}/engine/state'
    move_method, move_path, move = adapter.operations.get('moveClipToLane', (None, None, {}))
    move_body = resolve_schema(getattr(adapter, 'spec', {}), move.get('requestBody', {}).get('content', {}).get('application/json', {}).get('schema', {}))
    move_rest = (str(move_method).upper() == 'POST' and move_path == '/projects/{project_id}/clips/{clip_id}:move-to-lane' and
                 move_body.get('properties', {}).get('lane_id', {}).get('type') == 'string' and 'lane_id' in move_body.get('required', []))
    waveform_method, waveform_path, waveform = adapter.operations.get('getClipWaveform', (None, None, {}))
    independent = (str(waveform_method).upper() == 'GET' and
                   waveform_path == '/projects/{project_id}/clips/{clip_id}/waveform')
    limit = next((param.get('schema', {}).get('maximum') for param in waveform.get('parameters', []) if param.get('name') == 'buckets'), 100)
    return {'crossTrackPaste': CROSS_TRACK_PASTE_ROLLOUT is True and move_rest,
            'waveformMaxBuckets': limit, 'waveformIndependentOfNative': independent, 'nativeState': 'studio-api-v1' if native_rest else 'rest-ticket-realtime',
            'deterministicTransport': 'studio-api-v1',
            # Plugin editor mirror (314-op contract): raw JPEG frames via the local
            # GET /api/editor/frame bridge; input via /api/call, sent once, never retried.
            'pluginEditorFrame': '/api/editor/frame' if 'getPluginEditorFrame' in adapter.operations else None,
            'pluginEditorInput': all(op in adapter.operations for op in ('sendPluginEditorPointer', 'sendPluginEditorScroll', 'sendPluginEditorKeys')),
            # Agent-safe mixing (318-op contract): getEngineMix ETag "mix-<n>" guards
            # mixer/bus/mix:apply writes; mix:wait long-polls (max 2 in flight).
            'mixRevision': all(op in adapter.operations for op in ('getEngineMix', 'applyEngineMix')),
            'mixWait': 'waitEngineMix' in adapter.operations,
            # 328-op contract: typed lane EQ, delete-by-instance, engine:reload.
            'laneEq': all(op in adapter.operations for op in ('getLaneEq', 'setLaneEqBand')),
            'pluginDeleteByInstance': 'deleteLanePluginInstance' in adapter.operations,
            'engineReload': 'reloadEngineSession' in adapter.operations,
            # 338-op contract.
            'regionEffectInPlace': 'in_place' in (resolve_schema(getattr(adapter, 'spec', {}), adapter.operations.get('applyRegionEffect', (None, None, {}))[2].get('requestBody', {}).get('content', {}).get('application/json', {}).get('schema', {})).get('properties', {}).get('mode', {}).get('enum') or []),
            'pluginRestore': 'addLanePlugin' in adapter.operations and 'state' in (resolve_schema(getattr(adapter, 'spec', {}), adapter.operations['addLanePlugin'][2].get('requestBody', {}).get('content', {}).get('application/json', {}).get('schema', {})).get('properties', {}) if 'addLanePlugin' in adapter.operations else {}),
            'busPan': 'setBusPan' in adapter.operations, 'masterPan': 'setMasterPan' in adapter.operations}
