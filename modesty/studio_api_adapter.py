"""Compatibility DTOs for Modesty's UI over the generated Studio REST client.

Names here are local application commands, not outbound MCP tool calls. Native
state comes from the typed authoritative Studio API engine-state read.
"""
from dataclasses import dataclass, field
from copy import deepcopy
from pathlib import Path
import json
import re
import uuid
from studio_api_realtime import NativeSnapshotError, _snapshot_state
from studio_api_client import StudioApiError, BINARY_OPERATIONS, NON_RETRYING_OPERATIONS, MIX_OPERATIONS, mix_etag
import base64
import threading


class StudioOperationError(Exception):
    def __init__(self, code, message, status=400, details=None):
        super().__init__(message)
        self.code = self.error = code
        self.detail = message
        self.status = status
        self.details = details


@dataclass
class StudioCall:
    operation_id: str
    path: dict = field(default_factory=dict)
    query: dict = field(default_factory=dict)
    body: object = None
    headers: dict = field(default_factory=dict)
    idempotency_key: str = None
    if_match: str = None

    def kwargs(self):
        return {"path": self.path, "query": self.query, "body": self.body,
                "headers": self.headers, "idempotency_key": self.idempotency_key,
                "if_match": self.if_match}


# Explicit primary aliases resolve the intentionally repeated MCP references
# in the published spec (list vs individual resources; specialized point edits).
PRIMARY = {
    "list_automation": "listAutomation", "create_automation": "createAutomationEnvelope",
    "update_automation": "updateAutomationEnvelope", "delete_automation": "deleteAutomationEnvelope",
    "get_saved_plugin_state": "getSavedLanePluginState", "get_project": "getProject",
    "create_track": "createLane", "create_empty_lane": "createLane", "rename_track": "updateLane",
    "remove_track": "deleteLane", "set_lane_identity": "updateLane",
    "set_track_gain": "setLaneGain", "set_track_pan": "setLanePan",
    "set_track_muted": "setLaneMute", "set_track_soloed": "setLaneSolo",
    "set_bus_gain": "setBusGain", "set_bus_muted": "setBusMute", "set_bus_soloed": "setBusSolo",
    "get_transport": "getTransport", "get_transport_clock": "getTransportClock",
    "set_transport_loop": "setLoop", "list_patterns": "listPatterns",
    "list_pattern_placements": "listPatternPlacements", "get_pattern": "getPattern",
    "attach_clip_to_session": "attachClipToSession", "set_lane_plugin_parameter": "setLanePluginParameter",
    "set_project_tempo": "setProjectTempo", "live_ingest_offer": "sendLiveIngestOffer",
    "live_ingest_close": "closeLiveIngest", "get_live_status": "getLiveIngestStatus",
    "start_audio_monitor": "startAudioMonitor", "rick_webrtc_offer": "sendMonitorOffer",
    "set_plugin_bypassed": "setLanePluginBypassed", "set_plugin_parameter": "setLanePluginParameter",
    "get_pro_state": "getEngineState", "move_clip_to_lane": "moveClipToLane",
    "copy_lane_effect_chain": "copyLaneEffectChain", "move_lane_plugin": "moveLanePlugin",
    "get_plugin_state": "listLanePluginParameters", "get_bus_plugin_live_state": "listBusPluginParameters",
    "set_bus_plugin_parameter": "setBusPluginParameter", "list_plugin_catalog": "listPluginCatalog",
    "add_lane_plugin": "addLanePlugin", "add_bus_plugin": "addBusPlugin",
    "register_pattern_sample": "registerPatternSample", "materialize_sound_pack_item": "registerPatternSample",
    # 328-op contract: both plugin deletes share the MCP equivalent. Keep the
    # established slot route; the instance route is deleteLanePluginInstance.
    "delete_lane_plugin": "deleteLanePlugin", "delete_lane_plugin_instance": "deleteLanePluginInstance",
    # 406-op contract: the dedicated setClipGain (PUT, If-Match) shares the MCP
    # equivalent. The clip-gain write keeps the route it was verified on.
    "set_clip_gain": "engine_set_clip_gain",
}
AI_COMMANDS = {"mozart_ai_command", "get_mozart_ai_job", "undo_last_ai_action"}
LIST_OUTPUTS = {"listPatterns": "patterns", "listPatternPlacements": "placements", "listBuses": "buses",
                "listProjectSaves": "saves"}
METHODS = {"get", "post", "put", "patch", "delete"}
EDITOR_OPERATIONS = frozenset({"getPluginEditorFrame"}) | NON_RETRYING_OPERATIONS
EDITOR_FRAME_HEADERS = (("etag", "etag"), ("revision", "x-editor-revision"), ("width", "x-editor-width"),
                        ("height", "x-editor-height"), ("pluginInstanceId", "x-editor-plugin-instance-id"),
                        ("pluginType", "x-editor-plugin-type"), ("contentType", "content-type"))


def _editor_error(operation_id, error):
    """Type plugin-editor failures: 429 rate limit and the no-open-editor quirk
    (409 editor_not_open, or 400 engine_invalid_arguments on a frame read)."""
    upstream, status = error.code, error.status
    details = dict(error.details) if isinstance(error.details, dict) else ({} if error.details is None else {"upstreamDetails": error.details})
    details.update(upstreamCode=upstream, upstreamStatus=status, operationId=operation_id,
                   retryable=False if operation_id in NON_RETRYING_OPERATIONS else status == 429)
    if status == 429:
        error.code = "editor_rate_limited"
        retry = error.headers and next((v for k, v in error.headers.items() if k.lower() == "retry-after"), None)
        try:
            details["retryAfterSec"] = max(0.0, float(retry)) if retry is not None else None
        except ValueError:
            details["retryAfterSec"] = None
    elif upstream == "editor_not_open" or (operation_id == "getPluginEditorFrame" and status == 400 and upstream == "engine_invalid_arguments"):
        error.code, error.status = "editor_not_open", 409
    error.details = details
    return error


# Typed engine/editor error codes (328-op contract). None is retried here; an
# unknown outcome (engine_timeout) must be verified by a read, not repeated.
TYPED_ERRORS = {
    "lane_has_no_live_chain": {"category": "engine_state", "action": "reload_engine_or_sync_lane"},
    "engine_divergent": {"category": "engine_state", "action": "reload_engine"},
    "input_unconfirmed": {"category": "editor_input", "action": "none"},
    "not_hit_testable": {"category": "editor_input", "action": "none"},
    "no_editor_view": {"category": "editor_input", "action": "open_editor"},
    "editor_not_open": {"category": "editor_state", "action": "open_editor"},
    "plugin_instance_not_found": {"category": "plugin_state", "action": "reread_chain"},
    "engine_timeout": {"category": "outcome_unknown", "action": "poll_engine_state"},
    "recording_in_progress": {"category": "engine_state", "action": "wait"},
    "studio_busy_on_other_project": {"category": "engine_state", "action": "wait"},
    # 338-op contract: typed 503s. The request was refused; back off for
    # Retry-After before a NEW user action. The bridge itself never retries.
    "engine_session_contended": {"category": "engine_unavailable", "action": "backoff", "backoff": True},
    "engine_session_not_found": {"category": "engine_unavailable", "action": "backoff", "backoff": True},
    "engine_restarting": {"category": "engine_unavailable", "action": "backoff", "backoff": True},
    # One in-place region render at a time per clip; extras get 503 render_busy + Retry-After.
    "render_busy": {"category": "engine_unavailable", "action": "backoff", "backoff": True},
    "restore_state_invalid": {"category": "plugin_state", "action": "reread_chain"},
}


# In-place region effects (339-op contract): RegionEffectJob.engine_status is the
# live engine's /clips/source/swap outcome.
#   status "done":   "swapped" (the clip plays the new revision) or "replay"
#                    (an earlier apply with this key; nothing re-sent).
#   status "failed", code "engine_swap_failed": the engine refused the swap.
#     rolled_back=true  -> NOTHING committed (previous source + revision kept):
#                          a definite rejection; retry is safe (the spec says
#                          with the same key; a new key is also safe).
#     rolled_back=false -> the new version stayed bound: reload the session.
#   engine_status values: source_unavailable, revision_conflict, clip_not_loaded,
#     session_project_mismatch, source_not_in_project, sample_rate_mismatch,
#     swap_failed, live_revision_mismatch, engine_timeout, engine_session_contended,
#     engine_session_not_found, engine_restarting, engine_update_required,
#     engine_error (other engine codes may appear).
ENGINE_SWAP_STATUSES = ("swapped", "replay", "source_unavailable", "revision_conflict", "clip_not_loaded",
                        "session_project_mismatch", "source_not_in_project", "sample_rate_mismatch", "swap_failed",
                        "live_revision_mismatch", "engine_timeout", "engine_session_contended",
                        "engine_session_not_found", "engine_restarting", "engine_update_required", "engine_error")


def engine_swap_failure(data):
    """Typed description of a failed in-place swap (job body or error details)."""
    rolled_back = data.get("rolled_back")
    if rolled_back is None and isinstance(data.get("details"), dict):
        rolled_back = data["details"].get("rolled_back")
    engine_status = data.get("engine_status")
    if engine_status is None and isinstance(data.get("details"), dict):
        engine_status = data["details"].get("engine_status")
    definite = rolled_back is True
    return {"typed": "engine_swap_failed", "category": "engine_swap", "engineStatus": engine_status,
            "rolledBack": rolled_back, "definiteRejection": definite, "committed": False if definite else None,
            "retryable": definite, "retryKey": "same" if definite else None,
            "action": "retry_same_key" if definite else "reload_engine"}


def _retry_after(error):
    value = next((v for k, v in (error.headers or {}).items() if k.lower() == "retry-after"), None)
    try:
        return max(0.0, float(value)) if value is not None else None
    except (TypeError, ValueError):
        return None


def _typed_error(error):
    if error.code == "engine_swap_failed":
        details = dict(error.details) if isinstance(error.details, dict) else {}
        details.update(engine_swap_failure({"details": details}), upstreamStatus=error.status)
        error.details = details
        return error
    kind = TYPED_ERRORS.get(error.code)
    if kind is not None:
        details = dict(error.details) if isinstance(error.details, dict) else ({} if error.details is None else {"upstreamDetails": error.details})
        details.update(kind, retryable=False, typed=error.code)
        if kind.get("backoff"):
            details["retryAfterSec"] = _retry_after(error)
            details.setdefault("engineReason", None)
            details["upstreamStatus"] = error.status
        error.details = details
    return error


CONFLICT_CODES = {"mix_revision_conflict": "currentMixRevision", "plugin_parameter_conflict": "currentValueNorm"}
MIX_WAIT_LIMIT = 2
# One local bridge serves one OAuth user; the count survives schema refreshes.
_MIX_WAITS = {"count": 0}
_MIX_WAIT_LOCK = threading.Lock()
_LAST = threading.local()


def _conflict_error(error):
    """412 mix_revision_conflict / plugin_parameter_conflict: typed, never
    retried, carrying the current revision/value when the body has it."""
    details = dict(error.details) if isinstance(error.details, dict) else {}
    current_key = CONFLICT_CODES[error.code]
    current = details.get(current_key)
    if current is None and isinstance(error.data, dict):
        envelope = error.data.get("error") if isinstance(error.data.get("error"), dict) else {}
        current = envelope.get(current_key, error.data.get(current_key))
    details.update(retryable=False, conflict=error.code, current=current)
    if current is not None:
        details[current_key] = current
    if error.code == "mix_revision_conflict" and isinstance(current, int) and not isinstance(current, bool):
        details["currentEtag"] = mix_etag(current)
    error.details = details
    return error


def mix_result(operation_id, response):
    """Mix reads/writes return their body plus the mix ETag; a mix:wait 304
    is the normal unchanged result."""
    tag = next((str(v) for k, v in (response.headers or {}).items() if k.lower() == "etag"), None)
    if response.status == 304 and operation_id == "waitEngineMix":
        return {"unchanged": True, "etag": tag, "mixRevision": None}
    data = deepcopy(response.data) if isinstance(response.data, dict) else {"response": deepcopy(response.data)}
    revision = data.get("mixRevision")
    if revision is None and isinstance(data.get("response"), dict):
        revision = data["response"].get("mix_revision")
    if revision is None and tag:
        match = re.fullmatch(r'(?:W/)?"?mix-(\d+)"?', tag)
        revision = int(match.group(1)) if match else None
    result = {**data, "etag": data.get("etag", tag), "mixRevision": revision}
    if operation_id in ("getEngineMix", "waitEngineMix"):
        result["unchanged"] = response.status == 304
    return result


def editor_frame_result(response):
    """A frame read as a typed value; 304 is a normal unchanged result."""
    def header(name):
        return next((str(v) for k, v in (response.headers or {}).items() if k.lower() == name), None)
    result = {key: header(name) for key, name in EDITOR_FRAME_HEADERS}
    for key in ("width", "height"):
        try:
            result[key] = int(result[key]) if result[key] is not None else None
        except ValueError:
            result[key] = None
    result["revision"] = result["revision"] or (result["etag"].strip('"') if result["etag"] else None)
    unchanged = response.status == 304
    if not unchanged and not isinstance(response.data, (bytes, bytearray)):
        raise StudioOperationError("invalid_editor_frame", "Freestyle returned no image bytes for the editor frame.", 502)
    return {**result, "status": response.status, "unchanged": unchanged, "bytes": None if unchanged else bytes(response.data)}


def _snake(value):
    return re.sub(r"(?<!^)(?=[A-Z])", "_", value).lower()


def _opaque(value, label):
    if not isinstance(value, str) or not value or len(value) > 128:
        raise StudioOperationError("studio_identity_required", "A durable %s is required for Studio API editing." % label)
    return value


def _schema(spec, value):
    while isinstance(value, dict) and "$ref" in value:
        key = value["$ref"]
        if not key.startswith("#/"):
            raise StudioOperationError("studio_schema_reference", "External schema references are not supported.")
        value = spec
        for part in key[2:].split("/"):
            value = value[part.replace("~1", "/").replace("~0", "~")]
    return value or {}


class StudioApiAdapter:
    def __init__(self, client, snapshot_reader=None, spec=None):
        self.client, self.snapshot_reader = client, snapshot_reader
        if spec is None:
            path = Path(__file__).parent / "docs" / "studio-openapi.json"
            with path.open() as handle:
                spec = json.load(handle)
        self.spec, self.operations, self.aliases = spec, {}, dict(PRIMARY)
        def alias(name, operation_id, path):
            current = self.aliases.get(name)
            if name in PRIMARY:
                return
            # Generated engine gateways repeat dedicated MCP equivalents, but
            # have different inferred schemas. Keep dedicated resource routes
            # authoritative regardless of OpenAPI path iteration order.
            previous = self.operations.get(current)
            if current is None or (previous and "/engine/actions/" in previous[1] and "/engine/actions/" not in path):
                self.aliases[name] = operation_id
        for path, methods in spec["paths"].items():
            for method, operation in methods.items():
                if method not in METHODS:
                    continue
                op = operation["operationId"]
                self.operations[op] = (method, path, operation)
                alias(op, op, path)
                alias(_snake(op), op, path)
                equivalent = operation.get("x-freestyle-mcp-equivalent", "")
                if re.fullmatch(r"[a-z][a-z0-9_]+", equivalent):
                    alias(equivalent, op, path)
                for action in re.findall(r"execute_pro_action\(([a-z0-9_]+)\)", equivalent):
                    alias(action, op, path)

    def _arguments(self, name, arguments):
        if not isinstance(arguments, dict):
            raise StudioOperationError("invalid_arguments", "Studio UI arguments must be an object.")
        args = deepcopy(arguments)
        if name == "execute_pro_action":
            name = args.pop("action", None)
            nested = args.pop("arguments", {})
            if not isinstance(nested, dict):
                raise StudioOperationError("invalid_arguments", "Action arguments must be an object.")
            args.pop("confirmed_destructive", None)
            if "project_id" in nested and args.get("project_id") is not None and nested["project_id"] != args["project_id"]:
                raise StudioOperationError("studio_scope_mismatch", "The action belongs to another project than its captured editor context.")
            args.update(nested)
        if not isinstance(name, str):
            raise StudioOperationError("invalid_operation", "Choose a Studio UI operation.")
        return name, args

    def _request(self, operation_id, args):
        method, template, operation = self.operations[operation_id]
        args = deepcopy(args)
        metadata = args.pop("_studio", {})
        if not isinstance(metadata, dict):
            raise StudioOperationError("invalid_arguments", "Studio transport metadata must be an object.")
        idem = metadata.get("idempotency_key") or args.pop("idempotency_key", args.pop("idempotencyKey", None))
        match = metadata.get("if_match") or args.pop("if_match", args.pop("ifMatch", None))
        path, query, headers = {}, {}, {}
        for parameter in operation.get("parameters", []):
            parameter = _schema(self.spec, parameter)
            key, where = parameter["name"], parameter["in"]
            if where == "path":
                value = args.pop(key, None)
                schema = _schema(self.spec, parameter.get("schema", {}))
                if schema.get("type") == "integer":
                    if not isinstance(value, int) or isinstance(value, bool):
                        raise StudioOperationError("studio_identity_required", "An integer %s is required." % key)
                    path[key] = value
                else:
                    path[key] = _opaque(value, key)
            elif where == "query" and key in args:
                query[key] = args.pop(key)
            elif where == "header" and key in args:
                headers[key] = args.pop(key)
        body_spec = _schema(self.spec, operation.get("requestBody", {}).get("content", {}).get("application/json", {}).get("schema", {}))
        body = {key: value for key, value in args.items() if key in body_spec.get("properties", {})} if "requestBody" in operation else None
        return StudioCall(operation_id, path, query, body, headers, idem, match)

    def resolve(self, name, arguments):
        name, args = self._arguments(name, arguments)
        if name in AI_COMMANDS:
            raise StudioOperationError("ai_operation_requires_mcp", "AI assistant commands use MCP, not the deterministic Studio adapter.")
        if name == "get_pro_state":
            if "getEngineState" not in self.operations:
                raise StudioOperationError("studio_operation_unsupported", "The typed engine-state REST read is not published in this contract.", 503)
            if args.get("track_id") is not None:
                if args.get("scope_track_id") is not None and args["scope_track_id"] != args["track_id"]:
                    raise StudioOperationError("studio_scope_mismatch", "The engine-state read has conflicting audio contexts.")
                args["scope_track_id"] = args.pop("track_id")
            return [self._request("getEngineState", args)]
        if name == "transport_control":
            command = args.pop("action", args.pop("command", None))
            if command == "status":
                return [self._request("getTransport", args)]
            if command in ("play", "pause", "seek", "play_range", "seek_and_play"):
                name = {"play": "play", "pause": "pause", "seek": "seek", "play_range": "playRange", "seek_and_play": "seek"}[command]
                if command == "seek_and_play":
                    args["play"] = True
                return [self._request(name, args)]
            if command == "stop":
                # There is no stop endpoint: pause then seek to the start, without
                # replaying either write after an ambiguous acknowledgement.
                meta = args.pop("_studio", {})
                base = meta.get("idempotency_key") or args.pop("idempotency_key", None) or str(uuid.uuid4())
                pause_key = str(uuid.uuid5(uuid.NAMESPACE_URL, base + ":pause"))
                seek_key = str(uuid.uuid5(uuid.NAMESPACE_URL, base + ":seek"))
                return [self._request("pause", {**args, "_studio": {**meta, "idempotency_key": pause_key}}),
                        self._request("seek", {**args, "seconds": 0, "play": False, "_studio": {**meta, "idempotency_key": seek_key}})]
            raise StudioOperationError("studio_operation_unsupported", "This transport command has no documented Studio API route.")
        if name in {"shift_clip", "trim_clip", "delete_clip", "copy_append_clip", "split_clip"}:
            clip_id = args.pop("clip_id", None) or args.get("track_id")
            _opaque(clip_id, "clip id")
            if name == "split_clip":
                raise StudioOperationError("studio_split_requires_lane", "Use the atomic time-range split with durable selected lane ids.")
            op = {"op": "remove" if name == "delete_clip" else "update", "id": clip_id}
            if name == "copy_append_clip":
                retained_key = args.get("idempotency_key") or args.get("idempotencyKey") or args.get("_studio", {}).get("idempotency_key")
                child = args.pop("child_id", None)
                if child is None:
                    child = uuid.uuid5(uuid.NAMESPACE_URL, "modesty-copy:%s:%s:%s" % (args.get("project_id"), clip_id, retained_key)).hex if retained_key else uuid.uuid4().hex
                op = {"op": "insert", "id": child, "source_id": clip_id}
            for field in ["start_ms", "duration_sec", "audio_offset_sec", "expected"]:
                if field in args:
                    op[field] = args.pop(field)
            if name == "copy_append_clip" and not all(field in op for field in ("start_ms", "duration_sec", "audio_offset_sec")):
                raise StudioOperationError("studio_copy_requires_source_geometry", "Copy needs the captured source duration and offset for an atomic Studio clip insert.")
            return [self._request("applyClipBatch", {**args, "ops": [op]})]
        if name == "move_clip_to_lane":
            operation = next((op for op, (_, path, _) in self.operations.items() if path == "/projects/{project_id}/clips/{clip_id}:move-to-lane"), None)
            if operation:
                return [self._request(operation, args)]
            raise StudioOperationError("studio_operation_pending", "The documented move-to-lane REST route has not appeared in the live OpenAPI contract yet. No MCP fallback was used.", 503)
        if name == "set_clip_appearance":
            raise StudioOperationError("studio_operation_unsupported", "Studio API v1 does not publish this audio-clip field mutation. No MCP fallback was used.")
        if name == "set_bus_gain" and args.get("bus_id") == "master":
            args.pop("bus_id", None)
            return [self._request("setMasterGain", args)]
        op = self.aliases.get(name)
        if not op:
            raise StudioOperationError("studio_operation_unsupported", "No documented Studio API route for '%s'. No MCP fallback was used." % name)
        if op == "browseCatalogSounds" and "search" in args:
            search = args.pop("search")
            if "q" in args and args["q"] != search:
                raise StudioOperationError("invalid_arguments", "The sound search has conflicting search and q filters.")
            args["q"] = search
        if op in {"setLanePluginParameter", "setBusPluginParameter"}:
            forms = [key for key in ("value_norm", "value") if key in args]
            if len(forms) != 1:
                raise StudioOperationError("invalid_parameter_form", "Send exactly one parameter value: value_norm or value.")
            properties = _schema(self.spec, self.operations[op][2]["requestBody"]["content"]["application/json"]["schema"]).get("properties", {})
            if forms[0] not in properties:
                raise StudioOperationError("unsupported_parameter_form", "This published parameter endpoint accepts normalized value_norm only.")
        if op in {"addLanePlugin", "addBusPlugin"}:
            if any(key in args for key in ("path", "vst_path", "plugin_path")):
                raise StudioOperationError("catalog_plugin_required", "Add plug-ins using an id from the live plug-in catalog.")
            plugin_id = _opaque(args.get("plugin_id"), "catalog plugin id")
            if "/" in plugin_id or "\\" in plugin_id or any(ord(c) < 32 for c in plugin_id):
                raise StudioOperationError("catalog_plugin_required", "Host file paths cannot identify a catalog plug-in.")
        if op in {"setLaneEqBand", "setPatternPlacementEqBand"} and "band" in args:
            band = args["band"]
            if isinstance(band, str) and band.isdigit():
                band = int(band)
            if isinstance(band, bool) or not isinstance(band, int) or not 0 <= band <= 7:
                raise StudioOperationError("invalid_eq_band", "EQ band must be an integer from 0 to 7.")
            args["band"] = str(band)
        if op == "moveLanePlugin" and "instance_id" in args:
            instance_id = args.pop("instance_id")
            if args.get("expected_plugin_instance_id", instance_id) != instance_id:
                raise StudioOperationError("studio_scope_mismatch", "The captured plug-in instance guards disagree.")
            args["expected_plugin_instance_id"] = instance_id
        if op == "registerPatternSample":
            selectors = {"track_id", "audio_file_id", "preset_pack_item_id", "sound_pack_item_id", "catalog_sound_id"}
            handle = args.pop("register", None)
            if handle is not None:
                if not isinstance(handle, dict) or len(handle) != 1 or not set(handle) <= selectors:
                    raise StudioOperationError("invalid_sample_source", "Use the catalog row's one-source registration handle.")
                for key, value in handle.items():
                    if key in args and args[key] != value:
                        raise StudioOperationError("invalid_sample_source", "The selected sample registration handles disagree.")
                    args[key] = value
            present = [key for key in selectors if key in args]
            if len(present) != 1:
                raise StudioOperationError("invalid_sample_source", "Use the catalog row's register handle or one explicit persisted audio or catalog source.")
            _opaque(args[present[0]], "sample source id")
        # Legacy UI field names are translated only where the REST convention is explicit.
        if op in {"createLane", "updateLane"}:
            args.setdefault("name", args.get("label"))
            if args.get("name") is None:
                args.pop("name", None)
        if op == "getSavedLanePluginState" and (args.get("clip_id") or args.get("track_id") and not args.get("lane_id")):
            op = "getSavedClipPluginState"
            args.setdefault("clip_id", args.get("track_id"))
        if "{lane_id}" in self.operations[op][1] and "lane_id" not in args:
            args["lane_id"] = args.get("track_id")
        if op == "attachClipToSession":
            args.setdefault("clip_id", args.get("db_track_id"))
        if op in {"createAutomationEnvelope", "updateAutomationEnvelope", "deleteAutomationEnvelope"}:
            for old, new in [("default_value", "defaultValue"), ("value_type", "valueType"), ("expected_revision", "expectedRevision")]:
                if old in args:
                    args[new] = args.pop(old)
        # setLanePan persist=false is the public sweep form ("persist=false while sweeping, then a final call
        # without it"): it passes through like setLaneGain / setMasterGain, but only as a real boolean.
        if op == "setLanePan" and "persist" in args and not isinstance(args["persist"], bool):
            raise StudioOperationError("invalid_arguments", "Lane pan persist must be true or false.")
        if op == "setLoop":
            for old, new in [("loop_enabled", "enabled"), ("loop_start_sec", "start_sec"), ("loop_end_sec", "end_sec")]:
                if old in args:
                    args[new] = args.pop(old)
        if op in {"getSavedLanePluginState", "getSavedClipPluginState"}:
            if args.get("clip_id") or args.get("track_id") and not args.get("lane_id"):
                op = "getSavedClipPluginState"
                args.setdefault("clip_id", args.get("track_id"))
        return [self._request(op, args)]

    def editor_frame(self, arguments):
        """GET .../editor/frame as {status, unchanged, bytes, revision, ...}."""
        calls = self.resolve("getPluginEditorFrame", arguments)
        return editor_frame_result(self._execute(calls[0]))

    def last_etag(self):
        """ETag of the last Studio response on this thread (forwarded by /api/call)."""
        return getattr(_LAST, "etag", None)

    def _execute(self, call):
        _LAST.etag = None
        response = self._execute_inner(call)
        _LAST.etag = next((str(v) for k, v in (getattr(response, "headers", None) or {}).items() if k.lower() == "etag"), None)
        data = getattr(response, "data", None)
        if (call.operation_id in ("applyRegionEffect", "getRegionEffectJob") and isinstance(data, dict)
                and data.get("status") == "failed" and data.get("code") == "engine_swap_failed" and "typedError" not in data):
            # A failed job is a 200 job resource: add the typed description
            # without altering any published field.
            response.data = {**data, "typedError": engine_swap_failure(data)}
        if (call.operation_id == "applyRegionEffect" and isinstance(data, dict) and data.get("mode") == "in_place"
                and data.get("status") == "done" and isinstance(data.get("revision"), str) and data["revision"]
                and isinstance(call.path, dict) and call.path.get("clip_id")):
            # In-place writes a new source version of the same clip; its undo is
            # sample-edits:undo with If-Match = revision. Adopt it as the clip's
            # current source revision so a stale cached one is never sent.
            try:
                self.client.seed_etag("undoClipSampleEdit", data["revision"], path={"project_id": call.path["project_id"], "clip_id": call.path["clip_id"]})
            except Exception:
                pass
        return response

    def _refresh_stale_timeline(self, call):
        """A write bumped the timeline without returning its revision: before the
        next guarded timeline write that carries no explicit revision, read the
        project once (as on a cold start) instead of sending a stale If-Match."""
        project = call.path.get("project_id") if isinstance(call.path, dict) else None
        stale = getattr(self.client, "timeline_stale", None)
        if not project or stale is None or not stale(project) or call.if_match is not None:
            return
        if any(str(key).lower() == "if-match" for key in (call.headers or {})):
            return
        if self.operations[call.operation_id][0] not in ("post", "put", "patch", "delete"):
            return
        if self.client.revision_domain(call.operation_id, call.path, call.body) != ("timeline", project):
            return
        if isinstance(call.body, dict) and call.body.get("expected_revision") is not None:
            return
        self.client.call("getProject", path={"project_id": project}, use_etag=False)

    def _execute_inner(self, call):
        if call.operation_id == "waitEngineMix":
            with _MIX_WAIT_LOCK:
                if _MIX_WAITS["count"] >= MIX_WAIT_LIMIT:
                    raise StudioOperationError("mix_wait_limit", "At most two mix waits may be in flight; reuse the pending wait.", 429)
                _MIX_WAITS["count"] += 1
            try:
                return self.client.call(call.operation_id, **call.kwargs())
            finally:
                with _MIX_WAIT_LOCK:
                    _MIX_WAITS["count"] -= 1
        if call.operation_id in EDITOR_OPERATIONS:
            try:
                response = self.client.call(call.operation_id, **call.kwargs())
            except StudioApiError as error:
                raise _typed_error(_editor_error(call.operation_id, error)) from None
            # Live input is confirmed by effect: ok:false (input_unconfirmed,
            # not_hit_testable, no_editor_view) is a typed, non-retried result.
            data = response.data
            if call.operation_id in NON_RETRYING_OPERATIONS and isinstance(data, dict) and data.get("ok") is False:
                code = data.get("code") if isinstance(data.get("code"), str) else "input_unconfirmed"
                details = {**TYPED_ERRORS.get(code, TYPED_ERRORS["input_unconfirmed"]), "retryable": False, "typed": code,
                           "delivered": True, "operationId": call.operation_id, "result": deepcopy(data)}
                raise StudioOperationError(code, data.get("message") or "The plugin editor did not confirm this input.", 409, details)
            return response
        kwargs = call.kwargs()
        if call.operation_id == "getClipWaveform":
            # Source ETags do not validate placement-bearing waveform bodies.
            kwargs["use_etag"] = False
        if call.operation_id == "moveClipToLane":
            expected = call.body.get("expected")
            if not isinstance(expected, dict) or not any(k in expected for k in ("lane_id", "start_ms")):
                kwargs["require_revision"] = True
        self._refresh_stale_timeline(call)
        try:
            return self.client.call(call.operation_id, **kwargs)
        except StudioApiError as error:
            if error.status == 412 and error.code in CONFLICT_CODES:
                raise _conflict_error(error) from None
            raise _typed_error(error) from None

    @staticmethod
    def _native_state(value, project_id):
        if not isinstance(value, dict) or value.get("projectId") != project_id:
            raise StudioOperationError("foreign_native_snapshot", "The engine state belongs to another project.", 502)
        try:
            state = _snapshot_state({"state": value}, project_id)
        except NativeSnapshotError as error:
            raise StudioOperationError(error.code, str(error), error.status) from None
        tracks = state["tracks"] if isinstance(state["tracks"], list) else state["tracks"]["tracks"]
        clips = state["clips"] if isinstance(state["clips"], list) else state["clips"]["clips"]
        runtime_tracks, durable_tracks, clip_ids, durable_clips = {}, set(), set(), set()
        for row in tracks:
            if not isinstance(row, dict) or type(row.get("id")) is not int or row["id"] < 0 or row["id"] in runtime_tracks:
                raise StudioOperationError("incomplete_native_snapshot", "The engine returned invalid or duplicate native tracks.", 502)
            durable = row.get("db_track_id")
            if durable is not None and (not isinstance(durable, str) or not durable or durable in durable_tracks):
                raise StudioOperationError("incomplete_native_snapshot", "The engine returned ambiguous persisted track membership.", 502)
            if durable is not None:
                durable_tracks.add(durable)
            for key in ("projectId", "project_id"):
                if row.get(key) is not None and row[key] != project_id:
                    raise StudioOperationError("foreign_native_snapshot", "The engine track belongs to another project.", 502)
            runtime_tracks[row["id"]] = durable
        for row in clips:
            if (not isinstance(row, dict) or type(row.get("clip_id")) is not int or row["clip_id"] < 0
                    or row["clip_id"] in clip_ids or type(row.get("mozart_track_id")) is not int
                    or row["mozart_track_id"] not in runtime_tracks):
                raise StudioOperationError("incomplete_native_snapshot", "The engine returned invalid native clip membership.", 502)
            clip_ids.add(row["clip_id"])
            lane = row.get("db_track_id")
            if lane is not None and lane != runtime_tracks[row["mozart_track_id"]]:
                raise StudioOperationError("incomplete_native_snapshot", "The engine clip and track lane membership disagree.", 502)
            durable = row.get("db_clip_id")
            if durable is not None and (not isinstance(durable, str) or not durable or durable in durable_clips):
                raise StudioOperationError("incomplete_native_snapshot", "The engine returned ambiguous persisted clip membership.", 502)
            if durable is not None:
                durable_clips.add(durable)
            for key in ("projectId", "project_id"):
                if row.get(key) is not None and row[key] != project_id:
                    raise StudioOperationError("foreign_native_snapshot", "The engine audio belongs to another project.", 502)
        return state

    @staticmethod
    def _etag(response):
        return next((str(value) for key, value in (response.headers or {}).items() if key.lower() == "etag"), None)

    def _pages(self, operation_id, args, expected_etag=None):
        rows, cursor, seen = [], args.get("cursor"), set()
        limit_schema = next((_schema(self.spec, parameter.get("schema", {})) for parameter in self.operations[operation_id][2].get("parameters", []) if parameter.get("in") == "query" and parameter.get("name") == "limit"), {})
        limit = min(200, limit_schema.get("maximum", 200))
        while True:
            page_args = {**args, "limit": limit}
            if cursor:
                page_args["cursor"] = cursor
            response = self._execute(self._request(operation_id, page_args))
            current = self._etag(response)
            if expected_etag is not None and current is not None and current != expected_etag:
                raise StudioOperationError("studio_revision_changed", "The project changed while its pages were read. Refresh it before editing.", 412)
            expected_etag = expected_etag or current
            data = response.data
            if not isinstance(data, dict) or not isinstance(data.get("data"), list) or not isinstance(data.get("pagination"), dict):
                raise StudioOperationError("studio_incomplete_page", "Studio returned no complete resource page.", 502)
            rows.extend(deepcopy(data["data"]))
            pagination = data["pagination"]
            cursor = pagination.get("nextCursor")
            more = pagination.get("hasMore")
            if more is False or more is None and cursor is None:
                if cursor:
                    raise StudioOperationError("studio_incomplete_page", "Studio returned contradictory pagination.", 502)
                return rows, expected_etag
            if not isinstance(cursor, str) or not cursor or cursor in seen:
                raise StudioOperationError("studio_incomplete_page", "Studio returned no advancing resource cursor.", 502)
            seen.add(cursor)

    def _project(self, args):
        response = self._execute(self._request("getProject", args))
        project, etag = deepcopy(response.data), self._etag(response)
        if not isinstance(project, dict) or project.get("id") != args.get("project_id"):
            raise StudioOperationError("studio_foreign_project", "Studio returned another project.", 502)
        counts, flags = project.get("counts", {}), project.get("truncated", {})
        for field, op in [("lanes", "listLanes"), ("clips", "listClips"), ("patterns", "listPatterns"), ("placements", "listPatternPlacements")]:
            values = project.get(field)
            missing = not isinstance(values, list)
            truncated = flags is True or isinstance(flags, dict) and bool(flags.get(field))
            mismatch = isinstance(counts, dict) and isinstance(counts.get(field), int) and (missing or len(values) != counts[field])
            if missing or truncated or mismatch:
                values, page_etag = self._pages(op, {"project_id": args["project_id"]}, etag)
                etag = etag or page_etag
                project[field] = values
                if isinstance(project.get("counts"), dict):
                    project["counts"][field] = len(values)
                if isinstance(project.get("truncated"), dict):
                    project["truncated"][field] = False
        return project

    def capability(self, action):
        op = self.aliases.get(action)
        if not op:
            raise StudioOperationError("studio_operation_unsupported", "No published Studio schema for this action.")
        method, path, operation = self.operations[op]
        properties = deepcopy(_schema(self.spec, operation.get("requestBody", {}).get("content", {}).get("application/json", {}).get("schema", {})).get("properties", {}))
        required = list(_schema(self.spec, operation.get("requestBody", {}).get("content", {}).get("application/json", {}).get("schema", {})).get("required", []))
        for parameter in operation.get("parameters", []):
            if parameter["in"] == "path" and parameter["name"] != "project_id":
                properties[parameter["name"]] = deepcopy(parameter["schema"])
                required.append(parameter["name"])
        if op == "setLanePan":
            properties = {"track_id": {"type": "string"}, "pan": {"type": "number", "minimum": -1, "maximum": 1, "x-unit": "-1 hard left, 0 center, 1 hard right"}, "persist": {"type": "boolean", "default": True}}
            required = ["track_id", "pan"]
        argument_schema = {"type": "object", "properties": properties, "required": list(dict.fromkeys(required)), "additionalProperties": False}
        if op in {"setLanePluginParameter", "setBusPluginParameter"}:
            if "value_norm" in properties:
                properties["value_norm"]["x-unit"] = "normalized (0..1)"
            if "value" in properties:
                properties["value"]["x-unit"] = "physical (parameter discovery unit)"
                argument_schema["oneOf"] = [{"required": ["value_norm"]}, {"required": ["value"]}]
        return {"name": action, "description": operation.get("description", operation.get("summary", "")), "argumentSchema": argument_schema, "mutates": method != "get", "destructive": method == "delete", "requiresConfirmation": operation.get("x-freestyle-confirmation") == "confirm=true", "schemaSource": "studio-openapi", "operationId": op}

    def call(self, name, arguments):
        name, args = self._arguments(name, arguments)
        if name == "get_pro_state":
            project_id = _opaque(args.get("project_id"), "project id")
            return self._native_state(self._execute(self.resolve(name, args)[0]).data, project_id)
        if name == "list_pro_capabilities":
            if args.get("action"):
                return self.capability(args["action"])
            return {"actions": [self.capability(alias) for alias in sorted(PRIMARY) if alias in self.aliases]}
        if name == "get_project":
            return self._project(args)
        if name in {"copy_append_clip", "split_clip"}:
            project = self._project({"project_id": args.get("project_id")})
            identity = args.get("clip_id") or args.get("track_id")
            candidates = [clip for clip in project.get("clips", []) if clip.get("id") == identity]
            if not candidates and "clip_id" not in args:
                candidates = [clip for clip in project.get("clips", []) if clip.get("laneId") == identity]
            if len(candidates) != 1:
                raise StudioOperationError("studio_source_ambiguous", "Choose one durable source clip before copying or splitting.")
            source = candidates[0]
            if name == "split_clip":
                cut = args.get("split_ms")
                if not isinstance(cut, (int, float)) or isinstance(cut, bool):
                    raise StudioOperationError("invalid_arguments", "Split needs its exact timeline position in milliseconds.")
                overlaps = [row for row in project["clips"] if row.get("laneId") == source.get("laneId") and isinstance(row.get("durationSec"), (int, float)) and row.get("startMs", 0) < cut < row.get("startMs", 0) + row["durationSec"] * 1000]
                if len(overlaps) != 1 or overlaps[0].get("id") != source["id"]:
                    raise StudioOperationError("studio_split_ambiguous", "This split intersects more than its captured source clip.")
                request = self._request("editTimeRange", {**args, "operation": "split", "lane_ids": [source["laneId"]], "start_ms": cut, "end_ms": cut})
                return self._execute(request).data
            args["clip_id"] = source["id"]
            for key, field in [("duration_sec", "durationSec"), ("audio_offset_sec", "audioOffsetSec")]:
                if key not in args:
                    value = source.get(field)
                    if not isinstance(value, (int, float)) or isinstance(value, bool):
                        raise StudioOperationError("studio_source_geometry_required", "The source clip's stored timing is incomplete.")
                    args[key] = value
            args.setdefault("expected", {"start_ms": source["startMs"], "duration_sec": source["durationSec"], "audio_offset_sec": source["audioOffsetSec"]})
        if name == "list_automation":
            ids = args.pop("clip_ids", None)
            if ids is not None and not isinstance(ids, list):
                raise StudioOperationError("invalid_arguments", "clip_ids must be an array.")
            filters = [{**args, "clip_id": value} for value in ids] if ids is not None else [args]
            rows, seen = [], set()
            for values in filters:
                page, _ = self._pages("listAutomation", values)
                for row in page:
                    key = row.get("id") or json.dumps([row.get("clipId"), row.get("targetKey"), row.get("target")], sort_keys=True)
                    if key not in seen:
                        seen.add(key)
                        rows.append(row)
            return {"projectId": args.get("project_id"), "envelopes": rows, "truncated": False}
        calls = self.resolve(name, args)
        if len(calls) == 1 and calls[0].operation_id in BINARY_OPERATIONS:
            # JSON bridge form (/api/call): bytes as base64. /api/editor/frame serves raw bytes.
            frame = editor_frame_result(self._execute(calls[0]))
            data = frame.pop("bytes")
            return {**frame, "base64": base64.b64encode(data).decode("ascii") if data is not None else None}
        if len(calls) == 1 and calls[0].operation_id in MIX_OPERATIONS:
            return mix_result(calls[0].operation_id, self._execute(calls[0]))
        if len(calls) == 1 and calls[0].operation_id in LIST_OUTPUTS:
            operation = calls[0].operation_id
            rows, _ = self._pages(operation, args)
            return {LIST_OUTPUTS[operation]: rows, "truncated": False}
        result = None
        for call in calls:
            response = self._execute(call)
            result = response.data
            # Surface a pattern-document write's new revision (ETag) to the
            # browser so retained pattern intents record what they produced.
            tag = self._etag(response)
            if tag and isinstance(result, dict) and "etag" not in result and call.operation_id in ("updatePattern", "createPattern"):
                result = {**result, "etag": tag}
        if calls[-1].operation_id in {"listProjects", "listLibraryAssets"}:
            key = "projects" if calls[-1].operation_id == "listProjects" else "assets"
            if isinstance(result, dict) and isinstance(result.get("data"), list):
                pagination = result.get("pagination", {})
                return {key: result["data"], "nextCursor": pagination.get("nextCursor"), "total": pagination.get("total"), "hasMore": pagination.get("hasMore", False)}
        if calls[-1].operation_id == "createLane" and isinstance(result, dict):
            lane = result.get("track", result.get("lane", {}))
            if isinstance(lane, dict) and lane.get("id"):
                result = {**result, "laneId": lane["id"]}
        return result
