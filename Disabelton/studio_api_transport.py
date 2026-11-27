"""Allowlisted Studio API v1 transport. OAuth credentials never reach the UI."""
from __future__ import annotations

import http.client
import json
import math
import select
from pathlib import Path
import re
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections import deque
from copy import deepcopy
from threading import Lock
from time import perf_counter, sleep, time


RETAINED_KEY_OPERATIONS = frozenset({"uploadPatternSample", "placePatternSampleOnTimeline"})
IF_MATCH_OPERATIONS = frozenset({"placePatternSampleOnTimeline"})
# Response headers the browser may see. Plugin editor frames describe their
# revision/size/instance in X-Editor-* headers (getPluginEditorFrame).
# Long enough to cover a whole QA round: mix:wait long-polls alone add ~6 records a minute.
DIAGNOSTIC_RING = 512
PASSTHROUGH_HEADERS = ("ETag", "Retry-After", "X-Request-ID", "X-Editor-Revision", "X-Editor-Width",
                       "X-Editor-Height", "X-Editor-Plugin-Instance-Id", "X-Editor-Plugin-Type",
                       # Round 13: frame provenance (stale pixels, capture source, window binding).
                       "X-Editor-Frame-Stale", "X-Editor-Capture-Source", "X-Editor-Window-Id", "X-Editor-Bound-To-Instance")
MAX_BINARY_RESPONSE = 8 * 1024 * 1024
# 338: a contended, missing or restarting engine session answers 503 with one of
# these codes and Retry-After. Nothing was applied, so the identical request is
# resent a bounded number of times, but only when that is provably safe: a read,
# or a write whose operation declares Idempotency-Key (the same key is resent, so
# the server replays rather than repeats). Every other 503 is returned as is.
ENGINE_RETRY_CODES = frozenset({"engine_session_contended", "engine_session_not_found", "engine_restarting"})
# 2026-11-11: in-place region effects render one at a time; an extra apply is a
# 503 render_busy with Retry-After (nothing applied). It joins the same bounded
# retry ONLY when the write carries the caller's retained Idempotency-Key (the
# apply's own key), so a resend is a server replay, never a second render.
RENDER_RETRY_CODES = frozenset({"render_busy"})
ENGINE_RETRY_LIMIT = 2
ENGINE_RETRY_DEFAULT_SECONDS = 0.5
ENGINE_RETRY_MAX_SECONDS = 5.0


def engine_retry_delay(headers, value):
    """Seconds to wait before resending an engine-session 503 (Retry-After, clamped)."""
    seconds = None
    raw = (headers or {}).get("Retry-After")
    if isinstance(raw, str) and re.fullmatch(r"\s*\d+(?:\.\d+)?\s*", raw):
        seconds = float(raw)
    if seconds is None and isinstance(value, dict) and isinstance(value.get("error"), dict):
        error = value["error"]
        for key, scale in (("retryAfterMs", 1000.0), ("retry_after_ms", 1000.0), ("retryAfterSec", 1.0), ("retry_after", 1.0)):
            item = error.get(key)
            if isinstance(item, (int, float)) and not isinstance(item, bool) and math.isfinite(item) and item >= 0:
                seconds = item / scale
                break
    if seconds is None:
        seconds = ENGINE_RETRY_DEFAULT_SECONDS
    return max(0.0, min(ENGINE_RETRY_MAX_SECONDS, seconds))


def etag_conditional_read(operation):
    """A GET whose documented 200 response declares an ETag header."""
    response = ((operation or {}).get("responses") or {}).get("200") or {}
    return (operation or {}).get("method") == "GET" and any(str(name).lower() == "etag" for name in (response.get("headers") or {}))


def engine_retry_code(status, value):
    if status != 503 or not isinstance(value, dict) or not isinstance(value.get("error"), dict):
        return None
    code = value["error"].get("code")
    return code if code in ENGINE_RETRY_CODES or code in RENDER_RETRY_CODES else None


def _server_timing_ms(value):
    """Sum of upstream Server-Timing durations (numbers only; names dropped)."""
    if not isinstance(value, str) or len(value) > 1024:
        return None
    total, found = 0.0, False
    for match in re.finditer(r"(?:^|[;,\s])dur=([0-9]+(?:\.[0-9]+)?)", value):
        total += float(match.group(1))
        found = True
    return round(total, 3) if found else None


def binary_media_types(operation):
    """Image media types a documented 200 response declares (e.g. editor frames)."""
    content = ((operation.get("responses") or {}).get("200") or {}).get("content") or {}
    return tuple(sorted(kind for kind in content if re.fullmatch(r"image/[a-z0-9.+-]+", kind)))


class StudioProxyError(Exception):
    def __init__(self, status, code, message, stage="validation", **details):
        super().__init__(message)
        self.status = status
        self.data = {"error": {"code": code, "message": message, "stage": stage, **details}}


class NoStudioRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


STUDIO_HOST = "freestyle.audio"


class _PooledResponse:
    """urllib-shaped response; returns its connection to the pool only when the
    body was consumed completely and the server allowed keep-alive."""

    def __init__(self, pool, connection, response, reused):
        self._pool, self._connection, self._response = pool, connection, response
        self.code = self.status = response.status
        self.headers = response.headers
        self.reused = reused

    def read(self, amount=None):
        return self._response.read() if amount is None else self._response.read(amount)

    def close(self):
        connection, self._connection = self._connection, None
        if connection is None:
            return
        reusable = self._response.isclosed() and not self._response.will_close
        if not reusable:
            self._response.close()
        self._pool.release(connection, reusable)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


class StudioConnectionPool:
    """HTTP/1.1 keep-alive pool for the single allowlisted Studio API origin.

    urllib sends "Connection: close", so every bridge call previously paid a
    fresh TCP + TLS handshake (measured 150-260 ms). This pool keeps verified
    TLS connections open. It never follows redirects (http.client does not),
    and it never changes the TLS context: certificate and hostname checks stay
    those of the bridge context.

    A request on a reused connection that fails before any response bytes is
    retried once on a fresh connection only for GET/HEAD/OPTIONS. Writes are
    never resent; a dead idle socket is detected before a write is sent instead.
    """

    SAFE_RETRY_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})

    def __init__(self, tls_context, max_idle=8, max_idle_seconds=50.0, clock=None):
        self.tls_context, self.max_idle, self.max_idle_seconds = tls_context, max_idle, max_idle_seconds
        self._clock = clock or perf_counter
        self._idle = []  # (connection, released_at)
        self._lock = Lock()

    def _new(self, timeout):
        return http.client.HTTPSConnection(STUDIO_HOST, 443, timeout=timeout, context=self.tls_context())

    @staticmethod
    def _dropped(connection):
        sock = getattr(connection, "sock", None)
        if sock is None:
            return True
        try:
            readable, _, _ = select.select([sock], [], [], 0)
        except (OSError, ValueError):
            return True
        # An idle HTTP/1.1 socket is never readable unless the peer closed it
        # (EOF) or sent something unsolicited; either way it is not reusable.
        return bool(readable)

    def _acquire(self):
        now = self._clock()
        with self._lock:
            while self._idle:
                connection, released = self._idle.pop()
                if now - released <= self.max_idle_seconds and not self._dropped(connection):
                    return connection
                connection.close()
        return None

    def release(self, connection, reusable):
        if not reusable:
            connection.close()
            return
        with self._lock:
            if len(self._idle) < self.max_idle:
                self._idle.append((connection, self._clock()))
                return
        connection.close()

    def close(self):
        with self._lock:
            idle, self._idle = self._idle, []
        for connection, _ in idle:
            connection.close()

    def open(self, request, timeout=120):
        parts = urllib.parse.urlsplit(request.full_url)
        if parts.scheme != "https" or parts.hostname != STUDIO_HOST or parts.port not in (None, 443) or parts.username or parts.password:
            raise urllib.error.URLError("Only the Freestyle Studio API origin is pooled.")
        target = (parts.path or "/") + ("?" + parts.query if parts.query else "")
        method = request.get_method()
        headers = dict(request.header_items())
        body = request.data
        connection = self._acquire()
        reused = connection is not None
        while True:
            if connection is None:
                connection = self._new(timeout)
            else:
                connection.timeout = timeout
                if connection.sock is not None:
                    connection.sock.settimeout(timeout)
            try:
                connection.request(method, target, body=body, headers=headers)
                response = connection.getresponse()
            except (http.client.HTTPException, OSError):
                connection.close()
                if reused and method in self.SAFE_RETRY_METHODS:
                    connection, reused = None, False
                    continue
                raise
            return _PooledResponse(self, connection, response, reused)


def _value(value, schema, label):
    kind = schema.get("type")
    valid = (kind is None or kind == "string" and isinstance(value, str)
             or kind == "boolean" and isinstance(value, bool)
             or kind == "integer" and isinstance(value, int) and not isinstance(value, bool)
             or kind == "number" and isinstance(value, (int, float)) and not isinstance(value, bool)
             and math.isfinite(value))
    if not valid or "enum" in schema and value not in schema["enum"]:
        raise StudioProxyError(400, "invalid_studio_parameter", "Invalid " + label + ".")
    if isinstance(value, str):
        if len(value) < schema.get("minLength", 0) or len(value) > schema.get("maxLength", 4096):
            raise StudioProxyError(400, "invalid_studio_parameter", "Invalid " + label + " length.")
        if schema.get("pattern") and not re.search(schema["pattern"], value):
            raise StudioProxyError(400, "invalid_studio_parameter", "Invalid " + label + " format.")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if not math.isfinite(value) or value < schema.get("minimum", -math.inf) or value > schema.get("maximum", math.inf):
            raise StudioProxyError(400, "invalid_studio_parameter", "Invalid " + label + " range.")
    return str(value).lower() if isinstance(value, bool) else str(value)


class StudioApiTransport:
    def __init__(self, root, token, tls_context, open_request=None, sleep=sleep):
        self.root, self.token, self.tls_context = Path(root), token, tls_context
        self.open_request = open_request
        self.sleep = sleep
        self._pool = StudioConnectionPool(tls_context)
        self._operations = None
        self._diagnostic_lock = Lock()
        self._diagnostic_sequence = 0
        self._diagnostics = deque(maxlen=DIAGNOSTIC_RING)

    def _default_opener(self):
        # Keep urllib (and its environment proxy support) when an HTTPS proxy
        # applies; the keep-alive pool only dials the Studio origin directly.
        proxies = urllib.request.getproxies()
        if proxies.get("https") and not urllib.request.proxy_bypass(STUDIO_HOST):
            return urllib.request.build_opener(NoStudioRedirect(), urllib.request.HTTPSHandler(context=self.tls_context())).open
        return self._pool.open

    def diagnostics(self):
        """Detached, bounded timings only; never retain request bodies or URLs."""
        with self._diagnostic_lock:
            return deepcopy(list(self._diagnostics))

    def diagnostic_summary(self, sequence):
        """Compact timing boundaries of one retained transport record, or None.

        The bridge copies this into its own call record so a slow snapshot keeps
        its authorization/attempt timings after the transport ring evicts them.
        """
        with self._diagnostic_lock:
            record = next((item for item in reversed(self._diagnostics) if item.get("id") == sequence), None)
            if record is None:
                return None
            keep = ("attempt", "openerSetupMs", "responseHeadersMs", "bodyReadMs", "status",
                    "connectionReused", "upstreamServerTimingMs", "upstreamRequestId", "transportFailed")
            return {"authorizationMs": record.get("authorizationMs"), "totalMs": record.get("totalMs"),
                    "attempts": [{key: deepcopy(attempt[key]) for key in keep if key in attempt}
                                 for attempt in record.get("attempts", [])[:4]]}

    @property
    def operations(self):
        if self._operations is None:
            with (self.root / "docs/studio-api-operations.json").open() as handle:
                self._operations = json.load(handle)["operations"]
        return self._operations

    def prepare(self, payload):
        if not isinstance(payload, dict) or set(payload) - {"operationId", "path", "query", "body", "idempotencyKey", "ifMatch", "ifNoneMatch"}:
            raise StudioProxyError(400, "invalid_studio_request", "Use a documented Studio API operation.")
        operation_id = payload.get("operationId")
        operation = self.operations.get(operation_id) if isinstance(operation_id, str) else None
        if not operation:
            raise StudioProxyError(400, "unknown_studio_operation", "That Studio API operation is not in the current OpenAPI specification.")
        path, query = payload.get("path", {}), payload.get("query", {})
        if not isinstance(path, dict) or not isinstance(query, dict):
            raise StudioProxyError(400, "invalid_studio_parameters", "Path and query parameters must be objects.")
        known = {location: {p["name"]: p for p in operation["parameters"] if p["in"] == location} for location in ("path", "query")}
        for location, supplied in (("path", path), ("query", query)):
            if set(supplied) - set(known[location]):
                raise StudioProxyError(400, "unknown_studio_parameter", "An unsupported " + location + " parameter was supplied.")
            if any(p.get("required") and (key not in supplied or supplied[key] is None) for key, p in known[location].items()):
                raise StudioProxyError(400, "missing_studio_parameter", "A required " + location + " parameter is missing.")
        route = operation["path"]
        for name, value in path.items():
            text = _value(value, known["path"][name].get("schema", {}), name)
            if text in (".", "..") or any(char in text for char in "/\\%?#") or re.search(r"[\x00-\x20\x7f]", text):
                raise StudioProxyError(400, "invalid_studio_path", "Use an opaque Freestyle identifier in the API path.")
            route = route.replace("{" + name + "}", urllib.parse.quote(text, safe=""))
        encoded = []
        for name, value in query.items():
            if value is not None:
                encoded.append((name, _value(value, known["query"][name].get("schema", {}), name)))
        url = "https://freestyle.audio/api/v1" + route
        if encoded:
            url += "?" + urllib.parse.urlencode(encoded)
        body = payload.get("body")
        if operation_id == "updatePattern" and body is not None:
            from studio_api_adapter import documented_pattern_body
            try:
                body = documented_pattern_body(body)
            except ValueError as error:
                raise StudioProxyError(400, getattr(error, "code", "invalid_pattern_body"), str(error)) from None
        if operation_id == "engine_update_pattern" and body is not None:
            # Never both bars and lengthTicks (2026-11-11: disagreeing pair is 400).
            from studio_api_adapter import single_length_pattern_body
            body = single_length_pattern_body(body)
        if (operation.get("requestBody") or {}).get("required") and body is None:
            raise StudioProxyError(400, "missing_studio_body", "This Studio API operation needs a JSON body.")
        if body is not None and not operation.get("requestBody"):
            raise StudioProxyError(400, "unexpected_studio_body", "This operation does not accept a request body.")
        try:
            raw = json.dumps(body, allow_nan=False).encode() if body is not None else None
        except (ValueError, TypeError):
            raise StudioProxyError(400, "invalid_studio_body", "Send finite JSON values to Studio API.") from None
        media = binary_media_types(operation)
        headers = {"Accept": ", ".join(media + ("application/json",)), "User-Agent": "DisabeltonAmateur/1.0"}
        if raw is not None:
            headers["Content-Type"] = "application/json"
        # Upload admission and sample placement require one caller-retained key
        # (the published description says so even though the header parameter
        # is advertised optional); placement also needs the fresh timeline ETag.
        if operation_id in RETAINED_KEY_OPERATIONS and "idempotencyKey" not in payload:
            raise StudioProxyError(428, "idempotency_key_required", "This Studio write needs its retained Idempotency-Key.")
        if operation_id in IF_MATCH_OPERATIONS and payload.get("ifMatch") is None:
            raise StudioProxyError(428, "if_match_required", "Read the current timeline revision before placing this sample.")
        if operation["method"] not in ("GET", "HEAD", "OPTIONS"):
            key = payload["idempotencyKey"] if "idempotencyKey" in payload else str(uuid.uuid4())
            if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9._:-]{8,128}", key):
                raise StudioProxyError(400, "invalid_idempotency_key", "Use an 8–128 character write key.")
            headers["Idempotency-Key"] = key
        if payload.get("ifMatch") is not None:
            tag = payload["ifMatch"]
            if not isinstance(tag, str) or not tag or len(tag) > 512 or re.search(r"[\x00-\x1f\x7f]", tag):
                raise StudioProxyError(400, "invalid_etag", "Use the ETag returned by a project read.")
            headers["If-Match"] = tag
        keyed = any(p.get("in") == "header" and str(p.get("name", "")).lower() == "idempotency-key" for p in operation["parameters"])
        if payload.get("ifNoneMatch") is not None:
            # HTTP caching for typed reads: only a GET whose 200 response the
            # spec declares with an ETag header (e.g. getPatternSampleWaveform).
            # The upstream 304 is relayed with no body.
            tag = payload["ifNoneMatch"]
            if not etag_conditional_read(operation):
                raise StudioProxyError(400, "if_none_match_unsupported", "This Studio API operation does not declare an ETag for conditional reads.")
            if not isinstance(tag, str) or not tag or len(tag) > 512 or re.search(r"[\x00-\x1f\x7f]", tag):
                raise StudioProxyError(400, "invalid_etag", "Use the ETag returned by an earlier read.")
            headers["If-None-Match"] = tag
        return {"url": url, "method": operation["method"], "body": raw, "headers": headers, "binaryTypes": media,
                "engineRetrySafe": operation["method"] in ("GET", "HEAD", "OPTIONS") or keyed,
                # render_busy: only a keyed write that carries the caller's retained key.
                "renderRetrySafe": keyed and operation["method"] not in ("GET", "HEAD", "OPTIONS")
                and isinstance(payload.get("idempotencyKey"), str) and bool(payload.get("idempotencyKey"))}

    def call(self, payload):
        started = perf_counter()
        with self._diagnostic_lock:
            self._diagnostic_sequence += 1
            sequence = self._diagnostic_sequence
        record = {"id": sequence, "recordedAtUnixMs": round(time() * 1000), "attempts": [],
                  "prepareMs": 0, "authorizationMs": 0, "decodeRedactMs": 0}
        try:
            result = self._call(payload, record)
            result["_transportDiagnosticId"] = sequence
            return result
        finally:
            record["totalMs"] = round((perf_counter() - started) * 1000, 3)
            with self._diagnostic_lock:
                self._diagnostics.append(deepcopy(record))

    def _call(self, payload, record):
        started = perf_counter()
        prepared = self.prepare(payload)
        record["prepareMs"] = round((perf_counter() - started) * 1000, 3)
        record["operationId"] = payload["operationId"]  # Validated allowlisted name only.
        started = perf_counter()
        token = self.token()
        record["authorizationMs"] += (perf_counter() - started) * 1000
        attempted_tokens = [token]
        engine_retries = 0
        for attempt in range(2 + ENGINE_RETRY_LIMIT):
            timing = {"attempt": attempt + 1}
            record["attempts"].append(timing)
            request = urllib.request.Request(prepared["url"], data=prepared["body"], method=prepared["method"],
                                             headers={**prepared["headers"], "Authorization": "Bearer " + token})
            started = perf_counter()
            try:
                opener = self.open_request or self._default_opener()
                timing["openerSetupMs"] = round((perf_counter() - started) * 1000, 3)
                started = perf_counter()
                response = opener(request, timeout=120)
            except urllib.error.HTTPError as error:
                response = error
            except (urllib.error.URLError, http.client.HTTPException, OSError, TimeoutError):
                timing["transportFailed"] = True
                raise StudioProxyError(502, "studio_unreachable", "Could not reach Freestyle Studio API.", "transport") from None
            finally:
                timing["responseHeadersMs"] = round((perf_counter() - started) * 1000, 3)
            started = perf_counter()
            with response:
                status = response.code
                data = response.read(40 * 1024 * 1024 + 1)
                headers = {key: response.headers[key] for key in PASSTHROUGH_HEADERS
                           if response.headers.get(key) is not None and len(response.headers[key]) <= 512
                           and not re.search(r"[\x00-\x1f\x7f]", response.headers[key])}
                content_type = (response.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            timing["bodyReadMs"] = round((perf_counter() - started) * 1000, 3)
            timing["status"] = status
            if isinstance(getattr(response, "reused", None), bool):
                timing["connectionReused"] = response.reused
            upstream_ms = _server_timing_ms(response.headers.get("Server-Timing") if response.headers else None)
            if upstream_ms is not None:
                timing["upstreamServerTimingMs"] = upstream_ms
            if status == 401 and attempt == 0 and engine_retries == 0:
                started = perf_counter()
                token = self.token(force_refresh=True, rejected_token=token)
                record["authorizationMs"] += (perf_counter() - started) * 1000
                attempted_tokens.append(token)
                continue
            if 300 <= status < 400 and status != 304:
                raise StudioProxyError(502, "studio_redirect_refused", "Freestyle returned an unexpected API redirect.", "response")
            if len(data) > 40 * 1024 * 1024:
                raise StudioProxyError(502, "studio_response_too_large", "The Studio API response exceeded the bridge limit.", "response")
            headers = {key: value for key, value in headers.items() if not any(secret in value for secret in attempted_tokens)}
            if status == 200 and prepared["binaryTypes"] and content_type != "application/json":
                # A documented image body (plugin editor frame) passes through
                # byte-for-byte. It is never decoded, logged or retained.
                if content_type not in prepared["binaryTypes"]:
                    raise StudioProxyError(502, "invalid_studio_response", "Freestyle returned an undocumented media type.", "response")
                if not data or len(data) > MAX_BINARY_RESPONSE:
                    raise StudioProxyError(502, "studio_response_too_large" if data else "invalid_studio_response",
                                           "The plugin editor frame was empty or exceeded the bridge limit.", "response")
                timing["binaryBytes"] = len(data)
                record["authorizationMs"] = round(record["authorizationMs"], 3)
                record["decodeRedactMs"] = round(record["decodeRedactMs"], 3)
                return {"status": status, "headers": headers, "data": None, "binary": data, "contentType": content_type,
                        "idempotencyKey": None}
            started = perf_counter()
            try:
                value = json.loads(data) if data else None
            except (ValueError, UnicodeDecodeError):
                raise StudioProxyError(502, "invalid_studio_response", "Freestyle Studio API returned invalid JSON.", "response") from None
            def redact(item):
                if isinstance(item, str):
                    for secret in attempted_tokens:
                        item = item.replace(secret, "[redacted OAuth credential]")
                    return item
                if isinstance(item, float) and not math.isfinite(item):
                    raise StudioProxyError(502, "invalid_studio_response", "Freestyle Studio API returned nonfinite JSON.", "response")
                if isinstance(item, list):
                    return [redact(child) for child in item]
                if isinstance(item, dict):
                    return {redact(key): redact(child) for key, child in item.items()}
                return item
            headers = {key: value for key, value in headers.items() if not any(secret in value for secret in attempted_tokens)}
            safe_value = redact(value)
            request_id = headers.get("X-Request-ID")
            if (isinstance(request_id, str) and re.fullmatch(r"[A-Za-z0-9_.:-]{1,160}", request_id)
                    and request_id not in prepared["url"]
                    and (not prepared["body"] or request_id.encode() not in prepared["body"])):
                timing["upstreamRequestId"] = request_id
            retry_code = engine_retry_code(status, safe_value)
            retry_safe = prepared["renderRetrySafe"] if retry_code in RENDER_RETRY_CODES else prepared["engineRetrySafe"]
            if retry_code and retry_safe and engine_retries < ENGINE_RETRY_LIMIT:
                engine_retries += 1
                delay = engine_retry_delay(headers, safe_value)
                timing["engineRetry"] = retry_code
                timing["engineRetryDelayMs"] = round(delay * 1000, 3)
                record["decodeRedactMs"] += (perf_counter() - started) * 1000
                self.sleep(delay)
                continue
            if retry_code:
                timing["engineRetryExhausted" if retry_safe else "engineRetryRefused"] = retry_code
            if isinstance(safe_value, dict):
                for key in ("applied", "ok", "engine_reload_required", "dry_run"):
                    if isinstance(safe_value.get(key), bool):
                        timing[key] = safe_value[key]
            record["decodeRedactMs"] += (perf_counter() - started) * 1000
            record["authorizationMs"] = round(record["authorizationMs"], 3)
            record["decodeRedactMs"] = round(record["decodeRedactMs"], 3)
            return {"status": status, "headers": headers, "data": safe_value, "idempotencyKey": redact(prepared["headers"].get("Idempotency-Key"))}
