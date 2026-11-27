#!/usr/bin/env python3
"""Trashlab's loopback-only static host and Freestyle OAuth/MCP bridge.

Run: python3 server.py [--port 8080]
Credentials stay in .local/freestyle-auth.json (0600); the browser never gets them.
Only the Python standard library is required.
"""
from __future__ import annotations

import argparse
import collections
import base64
import hashlib
import fcntl
from contextlib import contextmanager
import html
import http.server
import http.client
import json
import mimetypes
import math
import os
from pathlib import Path
import re
import secrets
import ssl
import threading
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections import deque
from copy import deepcopy
from studio_api_transport import StudioApiTransport, StudioProxyError, DIAGNOSTIC_RING, PASSTHROUGH_HEADERS as STUDIO_PASSTHROUGH_HEADERS
from studio_api_adapter import plan_call, execute_plan, transport_payload, UnmappedStudioCall, StudioSnapshotConflict, StudioAPIResponseError, PRO_ACTIONS, AI_ONLY_ACTIONS

ROOT = Path(__file__).resolve().parent
DEFAULT_BASE = "https://freestyle.audio"
BASE = (os.environ.get("FREESTYLE_BASE") or DEFAULT_BASE).rstrip("/")
_base_parts = urllib.parse.urlsplit(BASE)
if _base_parts.scheme != "https" and _base_parts.hostname not in ("127.0.0.1", "localhost", "::1"):
    raise SystemExit("FREESTYLE_BASE must be an https:// Freestyle origin (http only for loopback).")
MCP_URL = BASE + "/api/mcp"
SCOPES = "profile:read projects:list projects:read projects:write daw:read daw:write ai:use audio:listen exports:read media:upload library:read library:write offline_access"
MAX_BODY = 36 * 1024 * 1024
CLIENT_LOG_CAPACITY = 5000  # round 13: 500 overflowed in one QA session (542 received)
CLIENT_LOG = collections.deque(maxlen=CLIENT_LOG_CAPACITY)  # local debug ring: browser-reported diagnostics (no credentials)
# Ring rollover and per-entry sequence gaps are reported, never silent. Each
# entry names its page load (`page`); `seq` restarts at 1 on a reload, so gaps
# are tracked per page and a page's first stored entry is marked pageStart.
CLIENT_LOG_STATS = {"posts": 0, "received": 0, "ignored": 0, "sequenceGaps": 0, "missingEntries": 0, "lastSeq": None, "pages": 0, "currentPage": None}
CLIENT_LOG_PAGES = collections.OrderedDict()  # page id -> last seq (bounded)


def _client_page(value):
    return value if isinstance(value, str) and 0 < len(value) <= 64 and value.isprintable() else None


def record_client_log(payload, now_ms=None):
    """Append browser diagnostics to the ring; count anything not stored."""
    entries = payload.get("entries") if isinstance(payload.get("entries"), list) else [payload]
    received = int(time.time() * 1000) if now_ms is None else now_ms
    CLIENT_LOG_STATS["posts"] += 1
    CLIENT_LOG_STATS["ignored"] += max(0, len(entries) - 50)
    for entry in entries[:50]:
        if not isinstance(entry, dict):
            CLIENT_LOG_STATS["ignored"] += 1
            continue
        page, seq = _client_page(entry.get("page")), entry.get("seq")
        stored = {"serverReceivedMs": received, **{k: entry[k] for k in list(entry)[:20]}}
        if page is not None:
            if page not in CLIENT_LOG_PAGES:
                CLIENT_LOG_STATS["pages"] += 1
                stored["pageStart"] = True
                CLIENT_LOG_PAGES[page] = None
                while len(CLIENT_LOG_PAGES) > 64:
                    CLIENT_LOG_PAGES.popitem(last=False)
            CLIENT_LOG_STATS["currentPage"] = page
            last = CLIENT_LOG_PAGES[page]
        else:
            last = CLIENT_LOG_STATS["lastSeq"]
        if isinstance(seq, int) and not isinstance(seq, bool):
            if isinstance(last, int) and seq > last + 1:
                CLIENT_LOG_STATS["sequenceGaps"] += 1
                CLIENT_LOG_STATS["missingEntries"] += seq - last - 1
            next_last = seq if not isinstance(last, int) or seq > last or (page is None and seq <= 1) else last
            if page is not None:
                CLIENT_LOG_PAGES[page] = next_last
            CLIENT_LOG_STATS["lastSeq"] = next_last
        CLIENT_LOG_STATS["received"] += 1
        CLIENT_LOG.append(stored)


def client_log_snapshot():
    return {"entries": list(CLIENT_LOG), "stats": {**CLIENT_LOG_STATS, "capacity": CLIENT_LOG.maxlen, "stored": len(CLIENT_LOG),
                                                   "overwritten": max(0, CLIENT_LOG_STATS["received"] - len(CLIENT_LOG))}}

MAX_REMOTE = 40 * 1024 * 1024
MAX_MEDIA_BYTES = 32 * 1024 * 1024
MAX_MEDIA_RANGE = 16 * 1024 * 1024
MEDIA_PREVIEW_PATH = re.compile(r"/api/marketplace/[A-Za-z0-9_/-]+")
MEDIA_SIGNED_LISTEN_PATH = re.compile(r"/api/mcp/listen/[0-9a-f]{32}/audio")
STATIC_TYPES = {".html", ".css", ".js", ".mjs", ".json", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".ico", ".wav", ".mp3", ".ogg", ".txt", ".md", ".woff", ".woff2", ".ttf", ".map"}


class APIError(Exception):
    def __init__(self, status, error, detail=None, metadata=None):
        super().__init__(detail or error)
        self.status, self.error, self.detail = status, error, detail or error
        self.metadata = safe_error_fields(metadata) if metadata else {}


def bridge_https_context():
    """Use platform trust first; optionally repair a demonstrably empty store.

    OpenSSL CA directories load lazily, so zero in-memory roots alone does not
    justify replacing a configured directory. Explicit trust settings always win.
    No context is weakened, and failed handshakes are never retried with new trust.
    """
    detail = ("Python could not load its TLS certificate settings. Check the Python CA "
              "certificates and SSL_CERT_FILE / SSL_CERT_DIR, then restart the bridge.")
    try:
        context = ssl.create_default_context()
    except (OSError, ValueError):
        raise APIError(502, "freestyle_tls_configuration_error", detail, {"retryable": False}) from None
    if "SSL_CERT_FILE" not in os.environ and "SSL_CERT_DIR" not in os.environ:
        try:
            empty = context.cert_store_stats().get("x509_ca") == 0
            paths = ssl.get_default_verify_paths()
            lazy_directory = bool(paths.capath and Path(paths.capath).is_dir())
        except (OSError, AttributeError, ValueError):
            # An unknown platform store must not be silently replaced.
            empty, lazy_directory = False, False
        if empty and not lazy_directory:
            missing = ("Python has no loaded CA certificates or configured CA directory. "
                       "Install your Python distribution's certificates, or install certifi "
                       "for this Python, then restart the bridge.")
            try:
                import certifi  # Optional fallback for Python installs without CA roots.
                context.load_verify_locations(cafile=certifi.where())
                if context.cert_store_stats().get("x509_ca", 0) <= 0:
                    raise ValueError("The optional CA bundle contains no trusted roots")
            except (ImportError, OSError, ValueError, TypeError, AttributeError):
                raise APIError(502, "freestyle_tls_configuration_error", missing, {"retryable": False}) from None
    # urllib's default HTTPS path advertises HTTP/1.1. Keep that behavior when
    # supplying an explicit context, including on Python 3.8/macOS.
    try:
        context.set_alpn_protocols(["http/1.1"])
    except (AttributeError, NotImplementedError):
        pass
    return context


def tls_verification_error(error):
    """Recognize typed TLS failures without forwarding URLs or secret-bearing text."""
    seen = set()
    for _ in range(6):
        if id(error) in seen:
            break
        seen.add(id(error))
        if isinstance(error, ssl.SSLCertVerificationError) or (isinstance(error, ssl.SSLError) and getattr(error, "reason", None) == "CERTIFICATE_VERIFY_FAILED"):
            return APIError(502, "freestyle_tls_verification_failed",
                            "Python could not verify Freestyle's TLS certificate. Check the system clock, "
                            "Python's CA certificates and any SSL_CERT_FILE / SSL_CERT_DIR settings, then restart the bridge.",
                            {"retryable": False})
        error = error.reason if isinstance(error, urllib.error.URLError) else getattr(error, "__cause__", None)
        if error is None:
            break
    return None


def clean_message(value):
    # Never relay OAuth credentials, even if an upstream error echoes an input.
    value = re.sub(r"fst_(?:at|rt|ac|sec|pat)_[A-Za-z0-9_.~-]+", "[redacted]", str(value))
    value = re.sub(r"(?i)(\bBearer\s+)[A-Za-z0-9._~+/=-]+", r"\1[redacted]", value)
    keys = r"access_token|refresh_token|id_token|client_secret|authorization_code|credential|password"
    value = re.sub(rf"(?i)(\b(?:{keys})\b[\"']?\s*[:=]\s*)([\"'])(.*?)\2", lambda match: match[1] + match[2] + "[redacted]" + match[2], value, flags=re.DOTALL)
    value = re.sub(rf"(?i)(\b(?:{keys})\b[\"']?\s*[:=]\s*)[^\r\n\"'&,}}]+", r"\1[redacted]", value)
    value = re.sub(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b", "[redacted]", value)
    value = re.sub(r"(?i)([?&](?:token|signature|sig|key|X-Amz-Signature)=)[^&#\s\"'<>]+", r"\1[redacted]", value)
    return value[:1600]


MAX_ERROR_BODY = 64 * 1024


SAFE_ERROR_DETAIL_KEYS = frozenset({"currentMixRevision", "expectedMixRevision", "currentValueNorm", "expectedValueNorm",
                                    "currentInstanceId", "currentPluginType", "current_instance_id", "current_plugin_type",
                                    # updatePattern bars/lengthTicks disagreement (400): the bars that lengthTicks implies.
                                    "expectedBars"})


def safe_error_fields(value):
    """Extract bounded diagnostics, never arbitrary upstream bodies or headers."""
    fields = {}

    def message(item):
        if not isinstance(item, str) or not item.strip() or len(item) > MAX_ERROR_BODY:
            return None
        if re.search(r"<\s*/?\s*[A-Za-z][^>]*>", item):
            return None
        if item.lstrip().startswith("{"):
            # Serialized response bodies must pass the same field allowlist.
            return None
        return clean_message(item.strip())

    def number(item, maximum):
        if isinstance(item, bool) or not isinstance(item, (int, float, str)):
            return None
        if isinstance(item, str) and len(item) > 32:
            return None
        try:
            parsed = float(item)
        except (ValueError, OverflowError):
            return None
        return parsed if math.isfinite(parsed) and 0 <= parsed <= maximum else None

    def visit(item, depth=0):
        if depth > 4:
            return
        if isinstance(item, str) and item.lstrip().startswith("{") and len(item) <= MAX_ERROR_BODY:
            try:
                item = json.loads(item)
            except (ValueError, RecursionError):
                return
        if not isinstance(item, dict):
            return
        for key in ("message", "error_description", "detail"):
            text = message(item.get(key))
            if text:
                fields["detail" if key == "detail" else "message"] = text
        code = item.get("code", item.get("errorCode", item.get("error_code")))
        if isinstance(code, int) and not isinstance(code, bool) and -(2 ** 31) <= code < 2 ** 31:
            fields["code"] = code
        elif isinstance(code, str) and re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", code):
            cleaned = clean_message(code)
            if cleaned == code:
                fields["code"] = code
        stage = item.get("stage")
        if isinstance(stage, str) and re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", stage) and clean_message(stage) == stage:
            fields["stage"] = stage
        request_id = item.get("upstreamRequestId")
        if isinstance(request_id, str) and re.fullmatch(r"[A-Za-z0-9_.:-]{1,160}", request_id) and clean_message(request_id) == request_id:
            fields["upstreamRequestId"] = request_id
        engine_status = item.get("engineStatus")
        if isinstance(engine_status, int) and not isinstance(engine_status, bool) and 0 <= engine_status <= 599:
            fields["engineStatus"] = engine_status
        elif isinstance(engine_status, str) and re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", engine_status) and clean_message(engine_status) == engine_status:
            fields["engineStatus"] = engine_status
        error = item.get("error")
        if isinstance(error, str) and not error.lstrip().startswith("{"):
            text = message(error)
            if text and "message" not in fields:
                fields["message"] = text
            if re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", error) and clean_message(error) == error:
                fields.setdefault("code", error)
        for key in ("upstreamStatus", "status", "statusCode", "http_status"):
            status = number(item.get(key), 599)
            if status is not None and status >= 400 and status.is_integer():
                fields["upstreamStatus"] = int(status)
        for output, aliases, maximum in (
            ("retryAfterSec", ("retryAfterSec", "retry_after_sec", "retry_after_seconds", "retryAfterSeconds", "retry_after"), 86400),
            ("retryAfterMs", ("retryAfterMs", "retry_after_ms"), 86400000),
        ):
            for key in aliases:
                delay = number(item.get(key), maximum)
                if delay is not None:
                    fields[output] = delay
                    break
        # Precondition conflicts (412 mix_revision_conflict / plugin_parameter_conflict,
        # 409 plugin_instance_mismatch) name the current server value; keep only
        # those bounded scalar identities/numbers so the UI can adopt them.
        details = item.get("details")
        if isinstance(details, dict):
            kept = {}
            for key, value in details.items():
                if key not in SAFE_ERROR_DETAIL_KEYS:
                    continue
                if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and abs(value) < 2 ** 63:
                    kept[key] = value
                elif isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", value) and clean_message(value) == value:
                    kept[key] = value
            if kept:
                fields["details"] = {**fields.get("details", {}), **kept}
        if isinstance(item.get("retryable"), bool):
            fields["retryable"] = item["retryable"]
        if isinstance(item.get("applied"), bool):
            fields["applied"] = item["applied"]
        if isinstance(item.get("rpcCode"), int) and not isinstance(item["rpcCode"], bool) and -(2 ** 31) <= item["rpcCode"] < 2 ** 31:
            fields["rpcCode"] = item["rpcCode"]
        # Only named error containers are considered, with a fixed depth bound.
        # HTTP failures can still carry a valid JSON-RPC MCP result envelope.
        # Inspect only named objects; never relay content blocks, raw headers or
        # arbitrary nested request/project data from that envelope.
        for key in ("error", "data", "response", "result", "structuredContent", "detail", "details", "cause", "body", "message", "error_description"):
            visit(item.get(key), depth + 1)

    visit({"message": value} if isinstance(value, str) and not value.lstrip().startswith("{") else value)
    return fields



def parse_rpc(raw, content_type, request_id):
    """Accept regular JSON and the response events used by Streamable HTTP MCP."""
    if "text/event-stream" not in content_type:
        try:
            result = json.loads(raw)
        except (ValueError, UnicodeDecodeError) as exc:
            raise APIError(502, "invalid_upstream_response", "Freestyle returned an invalid JSON response.") from exc
        if isinstance(result, list):
            result = next((v for v in result if isinstance(v, dict) and v.get("id") == request_id), None)
        if not isinstance(result, dict):
            raise APIError(502, "invalid_upstream_response", "Freestyle returned an invalid MCP response.")
        return result
    decoded = raw.decode("utf-8").replace("\r\n", "\n")
    for event in decoded.split("\n\n"):
        data = "\n".join(line[5:].lstrip(" ") for line in event.splitlines() if line.startswith("data:"))
        if not data:
            continue
        try:
            result = json.loads(data)
        except ValueError:
            continue
        if isinstance(result, dict) and result.get("id") == request_id:
            return result
    raise APIError(502, "invalid_upstream_response", "Freestyle sent no matching MCP response event.")


class NoMediaRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        return None


def media_range(value):
    if value is None:
        return None
    match = re.fullmatch(r"bytes=(?:(\d{1,12})-(\d{0,12})|-(\d{1,12}))", value)
    if not match:
        raise APIError(416, "invalid_media_range", "Use one valid byte range for audio preview.")
    start, end, suffix = match.groups()
    if suffix is not None:
        if int(suffix) <= 0:
            raise APIError(416, "invalid_media_range", "Audio suffix range must be positive.")
        return "bytes=-" + str(min(int(suffix), MAX_MEDIA_RANGE))
    start = int(start)
    end = int(end) if end else start + MAX_MEDIA_RANGE - 1
    if end < start:
        raise APIError(416, "invalid_media_range", "Audio range end must not precede its start.")
    return f"bytes={start}-{min(end, start + MAX_MEDIA_RANGE - 1)}"



# ---------------------------------------------------------------- standalone proxy
# The browser app runs the same Freestyle host contract as inside Freestyle
# (freestyle-standalone-host.js). Everything it needs from Freestyle goes through
# /fs/api/* here: this bridge only adds the OAuth bearer (the browser never sees
# it) and keeps warm keep-alive TLS connections so each call costs one request.
FS_PROXY_PREFIX = "/fs"
FS_FORWARD_REQUEST = ("content-type", "if-match", "if-none-match", "idempotency-key", "accept", "range",
                      "x-mozart-device", "prefer", "x-request-id", "mcp-protocol-version", "mcp-session-id")
FS_RETURN_HEADERS = ("content-type", "etag", "retry-after", "location", "content-range", "accept-ranges",
                     "cache-control", "idempotent-replayed", "x-request-id", "server-timing", "mcp-session-id")
_FS_POOL = []
_FS_POOL_LOCK = threading.Lock()


def _fs_connection(fresh=False):
    if not fresh:
        with _FS_POOL_LOCK:
            if _FS_POOL:
                return _FS_POOL.pop()
    parts = urllib.parse.urlsplit(BASE)
    if parts.scheme == "https":
        return http.client.HTTPSConnection(parts.netloc, timeout=90, context=bridge_https_context())
    return http.client.HTTPConnection(parts.netloc, timeout=90)


def _fs_release(conn, response):
    if response.will_close:
        conn.close()
        return
    with _FS_POOL_LOCK:
        if len(_FS_POOL) < 12:
            _FS_POOL.append(conn)
            return
    conn.close()


def fs_proxy_allowed(method, rel):
    raw_path = rel.split("?", 1)[0]
    path = urllib.parse.unquote(raw_path)
    # Decoded traversal / alternate separators never reach the upstream with a bearer.
    if (".." in path or "//" in path or "\\" in path or "%2f" in raw_path.lower() or "%5c" in raw_path.lower()
            or not path.startswith("/api/") or any(c in path for c in "\r\n\x00")):
        return False
    if path.startswith("/api/v1/") or path == "/api/mcp":
        return True
    # Media previews and signed listen audio are read-only.
    return method in ("GET", "HEAD") and not path.startswith(("/api/oauth", "/api/auth"))

class FreestyleClient:
    def __init__(self, root=ROOT, port=8080):
        self.root, self.port = Path(root).resolve(), port
        self.store = self.root / ".local" / ("freestyle-auth.json" if BASE == DEFAULT_BASE else "freestyle-auth-" + re.sub(r"[^a-z0-9.-]", "_", urllib.parse.urlsplit(BASE).netloc.lower()) + ".json")
        self.lock = threading.RLock()
        self._tls_context = None
        self.studio_api = StudioApiTransport(self.root, self._access_token, self._https_context)
        self._studio_diagnostic_lock = threading.Lock()
        self._studio_diagnostic_sequence = 0
        self._studio_diagnostics = deque(maxlen=DIAGNOSTIC_RING)
        self._credential_depth = 0
        self._store_seen = self.store.exists()
        self.pending = {}
        self.media_tickets = {}
        self.sequence = 0
        self.audio_device_id = str(uuid.uuid4())
        self.initialized = False
        self.live_tools = None
        self.data = {}
        if self.store.exists():
            try:
                self.data = json.loads(self.store.read_text())
                os.chmod(self.store, 0o600)
            except (OSError, ValueError):
                self.data = {}
        with (self.root / "docs" / "tools.json").open() as handle:
            self.documented_tools = json.load(handle)["tools"]
        self.environment_token = os.environ.get("FREESTYLE_ACCESS_TOKEN")

    @property
    def redirect_uri(self):
        return f"http://127.0.0.1:{self.port}/api/auth/callback"

    def _reload_store(self):
        try:
            data = json.loads(self.store.read_text())
        except FileNotFoundError:
            if self._store_seen:
                self.data = {}
            return
        except (OSError, ValueError):
            raise APIError(500, "credential_store_unavailable", "The saved Freestyle connection could not be read.") from None
        if not isinstance(data, dict):
            raise APIError(500, "credential_store_unavailable", "The saved Freestyle connection is invalid.")
        self.data, self._store_seen = data, True

    @contextmanager
    def _credential_store(self):
        # A stable lock inode is shared through either app's .local symlink.
        # Hold it across refresh and replacement so a rotated grant is used once.
        with self.lock:
            if self._credential_depth:
                self._credential_depth += 1
                try:
                    yield
                finally:
                    self._credential_depth -= 1
                return
            self.store.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            os.chmod(self.store.parent, 0o700)
            fd = os.open(self.store.with_suffix(".lock"), os.O_RDWR | os.O_CREAT, 0o600)
            try:
                os.fchmod(fd, 0o600)
                fcntl.flock(fd, fcntl.LOCK_EX)
                self._reload_store()
                self._credential_depth = 1
                try:
                    yield
                finally:
                    self._credential_depth = 0
            finally:
                fcntl.flock(fd, fcntl.LOCK_UN)
                os.close(fd)

    def _save(self):
        self.store.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self.store.parent, 0o700)
        fd, name = tempfile.mkstemp(prefix=self.store.name + ".", suffix=".tmp", dir=self.store.parent)
        temporary = Path(name)
        try:
            with os.fdopen(fd, "w") as handle:
                json.dump(self.data, handle)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.store)
            os.chmod(self.store, 0o600)
            self._store_seen = True
        finally:
            temporary.unlink(missing_ok=True)

    def _request(self, url, payload=None, form=False, bearer=None, timeout=120, extra_headers=None, method=None):
        headers = {"Accept": "application/json", "User-Agent": "Trashlab/1.0"}
        body = None
        if payload is not None:
            body = (urllib.parse.urlencode(payload).encode() if form else json.dumps(payload).encode())
            headers["Content-Type"] = "application/x-www-form-urlencoded" if form else "application/json"
        if bearer:
            headers["Authorization"] = "Bearer " + bearer
            headers["Accept"] = "application/json, text/event-stream"
            headers["MCP-Protocol-Version"] = "2025-11-25"
        if extra_headers:
            headers.update(extra_headers)
        request = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=timeout, context=self._https_context()) as response:
                raw = response.read(MAX_REMOTE + 1)
                content_type = response.headers.get("Content-Type", "application/json")
        except urllib.error.HTTPError as exc:
            try:
                raw = exc.read(MAX_ERROR_BODY + 1)
            finally:
                exc.close()
            metadata = {"upstreamStatus": exc.code}
            if len(raw) <= MAX_ERROR_BODY:
                try:
                    metadata.update(safe_error_fields(json.loads(raw)))
                except (ValueError, UnicodeDecodeError, RecursionError):
                    pass
            metadata["upstreamStatus"] = exc.code
            detail = metadata.get("detail") or metadata.get("message") or f"Freestyle returned HTTP {exc.code}."
            status = exc.code if exc.code in (400, 401, 403, 404, 409, 429) else 502
            raise APIError(status, "freestyle_error", detail, metadata=metadata) from None
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            tls_error = tls_verification_error(exc)
            if tls_error:
                raise tls_error from None
            raise APIError(502, "freestyle_unreachable", "Could not reach Freestyle. Check your connection and try again.") from exc
        if len(raw) > MAX_REMOTE:
            raise APIError(502, "response_too_large", "Freestyle response exceeded the local bridge's size limit.")
        return raw, content_type

    def _https_context(self):
        # Hot path without the shared lock: that RLock is also held across
        # upstream calls (token refresh, MCP initialize/tools), and every NEW
        # Studio connection needs this context. Round 19 snapshots stalled
        # 12-23 s on new connections only (reused ones were fast).
        context = self._tls_context
        if context is not None:
            return context
        with self.lock:
            if self._tls_context is None:
                self._tls_context = bridge_https_context()
            return self._tls_context

    def _json_request(self, *args, **kwargs):
        raw, _ = self._request(*args, **kwargs)
        if not raw:
            return {}
        try:
            return json.loads(raw)
        except ValueError as exc:
            raise APIError(502, "invalid_upstream_response", "Freestyle returned invalid JSON.") from exc

    def status(self):
        if not self.environment_token:
            with self._credential_store():
                return self._status()
        return self._status()

    def _status(self):
        connected = bool(self.environment_token or self.data.get("access_token"))
        return {"connected": connected, "provider": "Freestyle", "authRequired": not connected,
                "scopes": self.data.get("scope", "").split(), "toolsCount": len(self.live_tools or self.documented_tools),
                "requiresPro": True, "authUrl": "/api/auth/start",
                "studioApi": {"available": (self.root / "docs/studio-api-operations.json").exists(),
                              "missingDeterministicCallsEnabled": False, "mcpAiOnly": True}}

    def studio_call(self, payload):
        try:
            return self.studio_api.call(payload)
        except StudioProxyError as error:
            return {"status": error.status, "headers": {}, "data": error.data}
        except APIError as error:
            return {"status": error.status, "headers": {}, "data": {"error": {
                "code": error.metadata.get("code", error.error), "message": error.detail,
                "stage": error.metadata.get("stage", "authorization"), **error.metadata}}}

    def studio_diagnostics(self):
        with self._studio_diagnostic_lock:
            calls = deepcopy(list(self._studio_diagnostics))
        return {"calls": calls, "transport": self.studio_api.diagnostics(),
                "units": "milliseconds",
                "boundaries": {"responseHeadersMs": "HTTPS open through response headers, including DNS/TCP/TLS and upstream handling",
                               "authorizationMs": "Token acquisition, including credential lock and refresh if needed",
                               "readSlotWaitMs": "Sum of GET semaphore waits; parallel waits can overlap",
                               "executeMs": "Entire adapter execution, including all reads and transport; parallel totals are not additive"}}

    def prepare_media(self, payload):
        url = payload.get("url")
        if not isinstance(url, str) or len(url) > 2048:
            raise APIError(400, "invalid_media_url", "Choose an audio preview URL returned by Freestyle.")
        signed = False
        try:
            parsed = urllib.parse.urlsplit(url)
            origin_allowed = (parsed.scheme == "https" and parsed.hostname == "freestyle.audio"
                and not parsed.username and not parsed.password and not parsed.fragment
                and "#" not in url
                and not re.search(r"[\x00-\x20\x7f]", url))
            library = (origin_allowed and parsed.port in (None, 443) and not parsed.query
                and MEDIA_PREVIEW_PATH.fullmatch(parsed.path))
            # Region previews and listen renders carry a short-lived URL grant.
            # Accept only that observed route and exactly one opaque token. An
            # explicit port, alternate path or additional query cannot widen it.
            if origin_allowed and parsed.netloc == "freestyle.audio" and MEDIA_SIGNED_LISTEN_PATH.fullmatch(parsed.path):
                query = urllib.parse.parse_qs(parsed.query, keep_blank_values=True, strict_parsing=True, max_num_fields=2)
                tokens = query.get("token", [])
                signed = (parsed.query.startswith("token=") and set(query) == {"token"} and len(tokens) == 1
                    and re.fullmatch(r"[A-Za-z0-9_.-]{1,1800}", tokens[0]) is not None)
            allowed = library or signed
        except ValueError:
            allowed = False
        if not allowed:
            raise APIError(400, "invalid_media_url", "Only Freestyle library previews and signed listen audio routes are supported.")
        if not signed:
            self._access_token()
        now = time.time()
        with self.lock:
            self.media_tickets = {key: item for key, item in self.media_tickets.items() if item["expires"] > now}
            while len(self.media_tickets) >= 128:
                del self.media_tickets[next(iter(self.media_tickets))]
            ticket = secrets.token_urlsafe(24)
            self.media_tickets[ticket] = {"url": url, "expires": now + 300, "requires_oauth": not signed}
        return {"playbackUrl": "/api/media/" + ticket, "expiresInSec": 300}

    def open_media(self, ticket, range_header=None, head=False):
        if not re.fullmatch(r"[A-Za-z0-9_-]{20,128}", ticket):
            raise APIError(404, "media_ticket_expired", "This audio preview ticket is invalid or expired. Prepare the preview again.")
        with self.lock:
            item = self.media_tickets.get(ticket)
            if not item or item["expires"] <= time.time():
                self.media_tickets.pop(ticket, None)
                raise APIError(404, "media_ticket_expired", "This audio preview ticket is invalid or expired. Prepare the preview again.")
        requested_range = media_range(range_header)
        headers = {"Accept": "audio/*", "User-Agent": "Trashlab/1.0"}
        if item.get("requires_oauth", True):
            headers["Authorization"] = "Bearer " + self._access_token()
        if requested_range:
            headers["Range"] = requested_range
        request = urllib.request.Request(item["url"], headers=headers, method="HEAD" if head else "GET")
        try:
            opener = urllib.request.build_opener(NoMediaRedirect(), urllib.request.HTTPSHandler(context=self._https_context()))
            response = opener.open(request, timeout=30)
        except urllib.error.HTTPError as exc:
            if 300 <= exc.code < 400:
                raise APIError(502, "media_redirect_blocked", "Freestyle returned a media redirect. The local preview bridge only serves direct Freestyle audio responses.") from None
            detail = "Freestyle rejected the audio preview request."
            try:
                error = json.loads(exc.read(64 * 1024))
                candidate = error.get("error_description") or error.get("detail") or error.get("error")
                if isinstance(candidate, dict):
                    candidate = candidate.get("message")
                if isinstance(candidate, str):
                    if not item.get("requires_oauth", True):
                        # The opaque local ticket is the only grant exposed by
                        # this bridge, even if an upstream error reflects its URL.
                        token = urllib.parse.parse_qs(urllib.parse.urlsplit(item["url"]).query).get("token", [""])[0]
                        candidate = candidate.replace(item["url"], "[redacted media URL]")
                        if token:
                            candidate = candidate.replace(token, "[redacted media token]")
                    detail = clean_message(candidate)
            except (ValueError, OSError):
                pass
            status = exc.code if exc.code in (400, 401, 403, 404, 416, 429) else 502
            raise APIError(status, "media_upstream_error", detail) from None
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            tls_error = tls_verification_error(exc)
            if tls_error:
                raise tls_error from None
            raise APIError(502, "media_unreachable", "Could not reach Freestyle's audio preview service.") from exc
        try:
            content_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
            if not content_type.startswith("audio/"):
                raise APIError(502, "media_not_audio", "Freestyle did not return an audio media response. HTML and error documents cannot be served as previews.")
            status = response.status
            if status not in (200, 206):
                raise APIError(502, "invalid_media_response", "Freestyle returned an unsupported media response status.")
            safe_headers = {"Content-Type": content_type}
            length = response.headers.get("Content-Length")
            if length is not None:
                if not re.fullmatch(r"[0-9]{1,12}", length) or int(length) > MAX_MEDIA_BYTES:
                    raise APIError(413, "media_too_large", "Audio preview exceeds the local bridge's 32 MB response limit. Request a smaller byte range.")
                safe_headers["Content-Length"] = length
            content_range = response.headers.get("Content-Range")
            if content_range:
                if not re.fullmatch(r"bytes \d+-\d+/(?:\d+|\*)", content_range):
                    raise APIError(502, "invalid_media_response", "Freestyle returned an invalid audio byte range.")
                bounds = re.fullmatch(r"bytes (\d+)-(\d+)/(?:\d+|\*)", content_range)
                if int(bounds[2]) < int(bounds[1]) or int(bounds[2]) - int(bounds[1]) + 1 > MAX_MEDIA_BYTES:
                    raise APIError(502, "invalid_media_response", "Freestyle returned an invalid audio byte range.")
                safe_headers["Content-Range"] = content_range
            elif status == 206:
                raise APIError(502, "invalid_media_response", "Freestyle returned partial audio without byte range metadata.")
            if response.headers.get("Accept-Ranges", "").lower() == "bytes":
                safe_headers["Accept-Ranges"] = "bytes"
            return status, safe_headers, response
        except Exception:
            response.close()
            raise

    def workspace_context(self, values=None):
        path = self.root / ".local" / "trashlab-workspace-context.json"
        with self.lock:
            if values is None:
                try:
                    values = json.loads(path.read_text())
                except (OSError, ValueError):
                    values = {}
                if not isinstance(values, dict):
                    values = {}
                return {key: values.get(key, "") if isinstance(values.get(key, ""), str) else "" for key in ("projectId", "trackId")}
            if set(values) - {"projectId", "trackId"}:
                raise APIError(400, "invalid_context", "Workspace context accepts only projectId and trackId.")
            selected = {key: values.get(key, "") for key in ("projectId", "trackId")}
            if any(not isinstance(value, str) or len(value) > 256 for value in selected.values()):
                raise APIError(400, "invalid_context", "Project and track IDs must be strings of at most 256 characters.")
            path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            os.chmod(path.parent, 0o700)
            temporary = path.with_suffix(".tmp")
            fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as handle:
                json.dump(selected, handle)
            os.replace(temporary, path)
            os.chmod(path, 0o600)
            return selected

    def start_auth(self):
        with self._credential_store():
            # Reuse registration: dynamic registration is limited to ten/hour.
            if not self.data.get("client_id"):
                metadata = self._json_request(BASE + "/.well-known/oauth-authorization-server")
                endpoint = metadata.get("registration_endpoint", BASE + "/api/oauth/register")
                if not endpoint.startswith(BASE + "/"):
                    raise APIError(502, "invalid_oauth_metadata", "Unexpected Freestyle OAuth registration endpoint.")
                registered = self._json_request(endpoint, {
                    "client_name": "Trashlab (local browser DAW)",
                    "redirect_uris": [self.redirect_uri], "grant_types": ["authorization_code", "refresh_token"],
                    "response_types": ["code"], "token_endpoint_auth_method": "none", "scope": SCOPES})
                if not registered.get("client_id"):
                    raise APIError(502, "registration_failed", "Freestyle did not return an OAuth client ID.")
                self.data["client_id"] = registered["client_id"]
                self._save()
            state = secrets.token_urlsafe(32)
            verifier = secrets.token_urlsafe(64)
            challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
            self.pending = {key: flow for key, flow in self.pending.items() if flow["expires"] > time.time()}
            self.pending[state] = {"verifier": verifier, "expires": time.time() + 600, "client_id": self.data["client_id"]}
            query = {"response_type": "code", "client_id": self.data["client_id"], "redirect_uri": self.redirect_uri,
                     "scope": SCOPES, "state": state, "code_challenge": challenge, "code_challenge_method": "S256", "resource": MCP_URL}
            return {"authorizationUrl": BASE + "/oauth/authorize?" + urllib.parse.urlencode(query), "requiresPro": True}

    def finish_auth(self, params):
        state = params.get("state", [""])[0]
        with self._credential_store():
            flow = self.pending.pop(state, None)
            if not flow or flow["expires"] < time.time():
                raise APIError(400, "invalid_oauth_state", "This connection request expired or could not be verified. Connect again from Trashlab.")
            if params.get("error"):
                raise APIError(400, "authorization_denied", "Freestyle authorization was declined. Your local project is unchanged.")
            code = params.get("code", [""])[0]
            if not code:
                raise APIError(400, "missing_code", "Freestyle did not return an authorization code.")
            client_id = flow.get("client_id") or self.data["client_id"]
            tokens = self._json_request(BASE + "/api/oauth/token", {"grant_type": "authorization_code", "code": code,
                "redirect_uri": self.redirect_uri, "client_id": client_id, "code_verifier": flow["verifier"], "resource": MCP_URL}, form=True)
            self.data["client_id"] = client_id
            self._accept_tokens(tokens)
            self.environment_token = None
            self.initialized, self.live_tools = False, None

    def _accept_tokens(self, tokens):
        if not tokens.get("access_token"):
            raise APIError(502, "token_exchange_failed", "Freestyle did not return an access token.")
        for key in ("access_token", "refresh_token", "scope", "token_type"):
            if key in tokens:
                self.data[key] = tokens[key]
        self.data["expires_at"] = time.time() + float(tokens.get("expires_in", 3600))
        self._save()

    def fs_proxy(self, method, rel, body, headers):
        """One authenticated request to the Freestyle origin; one refresh on 401."""
        if not fs_proxy_allowed(method, rel):
            raise APIError(404, "not_found", "This path is not available through the local bridge.")
        token = self._access_token()

        def send(bearer):
            out = {k: v for k, v in headers.items() if k.lower() in FS_FORWARD_REQUEST}
            out["Authorization"] = "Bearer " + bearer
            out["User-Agent"] = "trashlab-bridge/1.0"
            out["Accept-Encoding"] = "identity"
            # Only idempotent or keyed requests are re-sent after a dropped connection
            # (a slow preview POST must never run twice).
            replayable = method in ("GET", "HEAD") or any(k.lower() == "idempotency-key" for k in out)
            for attempt in range(2 if replayable else 1):
                conn = _fs_connection(fresh=attempt > 0)
                try:
                    conn.request(method, rel, body=body if body else None, headers=out)
                    response = conn.getresponse()
                    data = response.read()
                    status, reply = response.status, {k.lower(): v for k, v in response.getheaders()}
                    _fs_release(conn, response)
                    return status, reply, data
                except ValueError:
                    conn.close()
                    raise APIError(400, "invalid_header", "A request header is not valid.") from None
                except (http.client.HTTPException, OSError):
                    conn.close()
                    if attempt or not replayable:
                        raise APIError(502, "upstream_unreachable", "Freestyle could not be reached.") from None
            raise APIError(502, "upstream_unreachable", "Freestyle could not be reached.")

        status, reply, data = send(token)
        if status == 401:
            token = self._access_token(force_refresh=True, rejected_token=token)
            status, reply, data = send(token)
        return status, reply, data

    def _access_token(self, force_refresh=False, rejected_token=None):
        with self.lock:
            if self.environment_token:
                if force_refresh:
                    raise APIError(401, "authorization_required", "The supplied Freestyle token expired. Connect your Freestyle account.")
                return self.environment_token
            rejected_token = rejected_token or self.data.get("access_token")
            with self._credential_store():
                if not self.data.get("access_token"):
                    raise APIError(401, "authorization_required", "Connect a Freestyle Pro account to use cloud tools.")
                expired = self.data.get("expires_at", 0) < time.time() + 30
                # A different server may already have replaced the rejected token.
                # Reuse that fresh token instead of rotating its grant a second time.
                replaced = rejected_token and self.data["access_token"] != rejected_token
                if expired or (force_refresh and not replaced):
                    if not self.data.get("refresh_token"):
                        raise APIError(401, "authorization_required", "Your Freestyle connection expired. Connect again.")
                    try:
                        tokens = self._json_request(BASE + "/api/oauth/token", {"grant_type": "refresh_token",
                            "refresh_token": self.data["refresh_token"], "client_id": self.data["client_id"], "resource": MCP_URL}, form=True)
                    except APIError as exc:
                        if exc.status in (400, 401, 403):
                            self.data.pop("access_token", None)
                            self.data.pop("refresh_token", None)
                            self._save()
                            raise APIError(401, "authorization_required", "Your Freestyle connection expired or was revoked. Connect again.") from None
                        raise
                    self._accept_tokens(tokens)
                return self.data["access_token"]

    def _rpc(self, method, params=None):
        # Reserve a unique ID only. A slow upstream tool must not hold the
        # credential/registry lock while unrelated transport or reads are ready.
        with self.lock:
            self.sequence += 1
            request_id = self.sequence
        request = {"jsonrpc": "2.0", "id": request_id, "method": method}
        if params is not None:
            request["params"] = params
        token = self._access_token()
        for attempt in range(2):
            try:
                raw, content_type = self._request(MCP_URL, request, bearer=token)
                break
            except APIError as exc:
                if exc.status != 401 or attempt:
                    raise
                token = self._access_token(force_refresh=True, rejected_token=token)
        response = parse_rpc(raw, content_type, request_id)
        if response.get("id") != request_id:
            raise APIError(502, "invalid_upstream_response", "Freestyle returned a mismatched MCP response.")
        if response.get("error"):
            error = response["error"]
            metadata = safe_error_fields(error)
            if isinstance(error, dict) and isinstance(error.get("code"), int) and not isinstance(error["code"], bool):
                metadata["rpcCode"] = error["code"]
            detail = metadata.get("detail") or metadata.get("message") or "Freestyle returned an MCP error."
            raise APIError(502, "mcp_error", detail, metadata=metadata)
        if "result" not in response:
            raise APIError(502, "invalid_upstream_response", "Freestyle returned no MCP result.")
        return response["result"]

    def initialize(self):
        with self.lock:
            if not self.initialized:
                self._rpc("initialize", {"protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": "trashlab", "version": "1.0.0"}})
                self.initialized = True

    def tools(self, refresh=False):
        # UI discovery is local OpenAPI-backed metadata, never tools/list over
        # MCP. Only an explicitly invoked AI tool enters _mcp_call below.
        connected = self.status()["connected"]
        tools = []
        for documented in self.documented_tools:
            tool = dict(documented)
            name = tool.get("name")
            tool["schemaSource"] = "studio-api-v1"
            if name == "execute_pro_action":
                tool["studioApiActions"] = sorted(PRO_ACTIONS)
                # The compatibility form must not advertise disabled native
                # actions as if a hidden MCP fallback would execute them.
                schema = json.loads(json.dumps(tool.get("inputSchema", {})))
                action = schema.get("properties", {}).get("action", {})
                if isinstance(action.get("enum"), list):
                    action["enum"] = [value for value in action["enum"] if value in PRO_ACTIONS or value in AI_ONLY_ACTIONS]
                tool["inputSchema"] = schema
            try:
                mapped = plan_call(name, {})
                tool["studioApiAvailable"] = mapped["kind"] != "mcp"
                tool["aiOnly"] = mapped["kind"] == "mcp"
            except UnmappedStudioCall as error:
                tool["studioApiAvailable"] = False
                tool["featureDisabledReason"] = error.reason
            except (ValueError, TypeError):
                # Missing arguments are expected during catalog discovery; a
                # known operation's runtime inputs are checked at dispatch.
                tool["studioApiAvailable"] = True
            tools.append(tool)
        return {"connected": connected, "source": "studio-api-v1", "tools": tools,
                "note": "Deterministic UI operations use Studio API v1. Missing v1 features are disabled; MCP is reserved for AI commands."}

    def call(self, name, arguments, *, idempotency_key=None, if_match=None, priority=None):
        started = time.perf_counter()
        with self._studio_diagnostic_lock:
            self._studio_diagnostic_sequence += 1
            record = {"id": self._studio_diagnostic_sequence, "recordedAtUnixMs": round(time.time() * 1000),
                      "operations": [], "readSlotWaitMs": 0, "readSlotCount": 0}
        try:
            if priority == "background":
                record["priority"] = "background"
            return self._call(name, arguments, idempotency_key=idempotency_key, if_match=if_match, diagnostic=record, priority=priority)
        finally:
            record["totalMs"] = round((time.perf_counter() - started) * 1000, 3)
            record["readSlotWaitMs"] = round(record["readSlotWaitMs"], 3)
            with self._studio_diagnostic_lock:
                self._studio_diagnostics.append(deepcopy(record))

    def _call(self, name, arguments, *, idempotency_key=None, if_match=None, diagnostic, priority=None):
        if not isinstance(name, str) or not name or len(name) > 160 or not re.fullmatch(r"[A-Za-z0-9_.-]+", name):
            raise APIError(400, "invalid_tool", "Provide a valid Freestyle operation name.")
        if not isinstance(arguments, dict):
            raise APIError(400, "invalid_arguments", "Operation arguments must be a JSON object.")
        try:
            started = time.perf_counter()
            plan = plan_call(name, arguments, idempotency_key=idempotency_key, if_match=if_match)
            diagnostic["planMs"] = round((time.perf_counter() - started) * 1000, 3)
            diagnostic["planKind"] = plan["kind"]
            if plan["kind"] == "mcp":
                return self._mcp_call(name, arguments)
            # Keep the same authorization boundary for local typed discovery.
            # No OAuth access token is ever included in a product response.
            if plan["kind"] == "local":
                self._access_token()
            def send(request):
                started = time.perf_counter()
                item = {"operationId": request["operationId"]}
                try:
                    response = self.studio_call(transport_payload(request))
                    item["transportDiagnosticId"] = response.get("_transportDiagnosticId")
                    # Keep this operation's authorization/attempt timings with the
                    # call: the 64-entry transport ring evicts them before a slow
                    # snapshot is inspected (round 9: a 6.2 s read lost its cause).
                    summary = getattr(self.studio_api, "diagnostic_summary", None)
                    if callable(summary) and item["transportDiagnosticId"] is not None:
                        transport_summary = summary(item["transportDiagnosticId"])
                        if transport_summary is not None:
                            item["transport"] = transport_summary
                    return response
                finally:
                    item["sendMs"] = round((time.perf_counter() - started) * 1000, 3)
                    with self._studio_diagnostic_lock:
                        # The ring is bounded even for a maximum-size paged snapshot.
                        if len(diagnostic["operations"]) < 128:
                            diagnostic["operations"].append(item)
                        else:
                            diagnostic["operationsTruncated"] = True
            def read_slot_wait(elapsed):
                with self._studio_diagnostic_lock:
                    diagnostic["readSlotWaitMs"] += elapsed
                    diagnostic["readSlotCount"] += 1
            send.record_read_slot_wait = read_slot_wait
            # Background reads use their own read slots (studio_api_adapter._BACKGROUND_READ_SLOTS).
            send.read_priority = "background" if priority == "background" else "interactive"
            started = time.perf_counter()
            try:
                result = execute_plan(plan, send)
            finally:
                diagnostic["executeMs"] = round((time.perf_counter() - started) * 1000, 3)
            return {"structuredContent": result, "isError": False}
        except UnmappedStudioCall as error:
            failure = APIError(error.status, error.code, str(error), {"code": error.code, "stage": error.stage})
            failure.metadata["name"] = error.name
            if isinstance(error.action, str) and re.fullmatch(r"[A-Za-z0-9_.-]{1,160}", error.action):
                failure.metadata["action"] = error.action
            raise failure from None
        except StudioSnapshotConflict as error:
            raise APIError(error.status, error.code, str(error), {"code": error.code, "stage": error.stage}) from None
        except StudioAPIResponseError as error:
            metadata = {"code": error.code, "stage": error.stage, "upstreamStatus": error.status}
            if error.engineStatus is not None:
                metadata["engineStatus"] = error.engineStatus
            if error.details is not None:
                metadata["details"] = error.details
            if error.requestId is not None:
                metadata["upstreamRequestId"] = error.requestId
            if getattr(error, "retryAfterSec", None) is not None:
                metadata["retryAfterSec"] = error.retryAfterSec
            raise APIError(error.status, error.code, str(error), metadata) from None
        except (ValueError, TypeError) as error:
            raise APIError(400, "invalid_studio_arguments", str(error), {"stage": "validation"}) from None

    def _mcp_tools(self, refresh=False):
        if not self.status()["connected"]:
            return {"connected": False, "source": "documentation", "tools": self.documented_tools,
                    "note": "Connect for authoritative live schemas. Nested object schemas in public documentation may be abbreviated."}
        with self.lock:
            self.initialize()
            if self.live_tools is None or refresh:
                items, cursor = [], None
                while True:
                    result = self._rpc("tools/list", {"cursor": cursor} if cursor else {})
                    items.extend(result.get("tools", []))
                    cursor = result.get("nextCursor")
                    if not cursor:
                        break
                docs = {tool["name"]: tool for tool in self.documented_tools}
                self.live_tools = [{**docs.get(tool.get("name"), {}), **tool, "schemaSource": "live"} for tool in items]
            return {"connected": True, "source": "live", "tools": self.live_tools}

    def _mcp_call(self, name, arguments):
        if not isinstance(name, str) or not name or len(name) > 160 or not re.fullmatch(r"[A-Za-z0-9_.-]+", name):
            raise APIError(400, "invalid_tool", "Provide a valid Freestyle tool name.")
        if not isinstance(arguments, dict):
            raise APIError(400, "invalid_arguments", "Tool arguments must be a JSON object.")
        self.initialize()
        if self.live_tools is not None and name not in {tool.get("name") for tool in self.live_tools}:
            # New upstream tools can appear while this browser/server stays open.
            # Refresh the authoritative registry before rejecting a new name.
            discovered = self._mcp_tools(refresh=True)["tools"]
            if name not in {tool.get("name") for tool in discovered}:
                raise APIError(400, "unknown_tool", "This tool is not advertised by the current Freestyle registry. Refresh the tool list or check its name.")
        return self._rpc("tools/call", {"name": name, "arguments": arguments})

    def disconnect(self):
        with self._credential_store():
            if self.data.get("refresh_token"):
                self._json_request(BASE + "/api/oauth/revoke", {"token": self.data["refresh_token"], "client_id": self.data["client_id"]}, form=True)
            self.data = {"client_id": self.data["client_id"]} if self.data.get("client_id") else {}
            self.environment_token, self.live_tools, self.initialized = None, None, False
            self.media_tickets.clear()
            self._save()
            return self.status()


class StudioHandler(http.server.BaseHTTPRequestHandler):
    server_version = "Trashlab/1.0"

    @property
    def client(self):
        return self.server.freestyle

    def log_message(self, fmt, *args):
        # Callback query strings contain one-use authorization codes.
        path = urllib.parse.urlsplit(self.path).path
        if path.startswith("/api/media/"):
            path = "/api/media/[ticket]"
        print(f"[{self.log_date_time_string()}] {self.command} {path}", flush=True)

    def _check_request(self, mutate=False):
        host = self.headers.get("Host", "")
        allowed = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
        if host not in allowed:
            raise APIError(403, "invalid_host", "This server accepts loopback requests only.")
        if mutate:
            origin = self.headers.get("Origin")
            if origin and origin not in {"http://" + item for item in allowed}:
                raise APIError(403, "invalid_origin", "Cross-origin API requests are not accepted.")
            if self.headers.get("Sec-Fetch-Site") == "cross-site":
                raise APIError(403, "invalid_origin", "Cross-site API requests are not accepted.")

    def _send(self, status, body, content_type="application/json; charset=utf-8", extra_headers=None):
        if not isinstance(body, bytes):
            body = body.encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        for key, value in (extra_headers or {}).items():
            if key in STUDIO_PASSTHROUGH_HEADERS and isinstance(value, str) and not re.search(r"[\x00-\x1f\x7f]", value):
                self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _proxy_media(self, ticket):
        status, headers, upstream = self.client.open_media(ticket, self.headers.get("Range"), head=self.command == "HEAD")
        with upstream:
            self.send_response(status)
            for key, value in headers.items():
                self.send_header(key, value)
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Cross-Origin-Resource-Policy", "same-origin")
            self.send_header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
            self.send_header("Connection", "close")
            self.close_connection = True
            self.end_headers()
            if self.command == "HEAD":
                return
            remaining = MAX_MEDIA_BYTES
            try:
                while True:
                    chunk = upstream.read(min(64 * 1024, remaining + 1))
                    if not chunk:
                        return
                    if len(chunk) > remaining:
                        return
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
            except (OSError, http.client.HTTPException):
                # Headers may already be sent: terminate the media stream rather
                # than appending a JSON error document to an audio response.
                return

    def _json(self, data, status=200):
        self._send(status, json.dumps(data))

    def _error(self, exc):
        if urllib.parse.urlsplit(self.path).path == "/api/studio":
            return self._json({"error": {"code": exc.error, "message": clean_message(exc.detail),
                                          "stage": "validation", **exc.metadata}}, exc.status)
        self._json({"error": exc.error, **exc.metadata, "detail": clean_message(exc.detail)}, exc.status)

    def _fs_proxy_request(self, method):
        """Forward /fs/api/* to the Freestyle origin (see fs_proxy). Returns True when handled."""
        raw = self.path
        if not raw.startswith(FS_PROXY_PREFIX + "/api/"):
            return False
        try:
            self._check_request(mutate=method not in ("GET", "HEAD"))
            if self.headers.get("Sec-Fetch-Site") in ("cross-site", "same-site"):
                raise APIError(403, "invalid_origin", "Cross-site requests are not accepted.")
            length = int(self.headers.get("Content-Length", "0") or 0)
            if length < 0 or length > MAX_BODY:
                raise APIError(413, "request_too_large", "Request body exceeds the size limit.")
            body = self.rfile.read(length) if length else b""
            status, reply, data = self.client.fs_proxy(method, raw[len(FS_PROXY_PREFIX):], body, dict(self.headers))
            self.send_response(status)
            for key in FS_RETURN_HEADERS:
                if key in reply:
                    self.send_header(key, reply[key])
            for key, value in reply.items():
                if key.startswith("x-editor-") or key.startswith("x-ratelimit"):
                    self.send_header(key, value)
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "default-src 'none'; sandbox")
            self.send_header("Cross-Origin-Resource-Policy", "same-origin")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            if method != "HEAD" and data:
                self.wfile.write(data)
        except APIError as exc:
            self._json({"error": {"code": exc.error, "message": clean_message(exc.detail)}}, exc.status)
        except (BrokenPipeError, ConnectionResetError):
            pass
        return True

    def do_DELETE(self):
        if not self._fs_proxy_request("DELETE"):
            self._json({"error": "not_found"}, 404)

    def do_PATCH(self):
        if not self._fs_proxy_request("PATCH"):
            self._json({"error": "not_found"}, 404)

    def do_PUT(self):
        if not self._fs_proxy_request("PUT"):
            self._json({"error": "not_found"}, 404)

    def do_HEAD(self):
        if self._fs_proxy_request("HEAD"):
            return
        self.do_GET()

    def do_GET(self):
        if self._fs_proxy_request("GET"):
            return
        try:
            self._check_request()
            parsed = urllib.parse.urlsplit(self.path)
            path = urllib.parse.unquote(parsed.path)
            if path == "/api/status":
                return self._json(self.client.status())
            if path == "/api/diagnostics/studio":
                return self._json(self.client.studio_diagnostics())
            if path == "/api/diagnostics/client":
                return self._json(client_log_snapshot())
            if path == "/api/tools":
                refresh = urllib.parse.parse_qs(parsed.query).get("refresh") == ["1"]
                return self._json(self.client.tools(refresh=refresh))
            if path == "/api/workspace":
                return self._json(self.client.workspace_context())
            if path.startswith("/api/media/"):
                return self._proxy_media(path[len("/api/media/"):])
            if path == "/api/auth/callback":
                try:
                    self.client.finish_auth(urllib.parse.parse_qs(parsed.query))
                    title, detail, status = "Freestyle connected", "You can return to Trashlab. This window will close automatically.", 200
                    script = '<script>if(window.opener){window.opener.postMessage("freestyle-connected",location.origin);window.close()}else{location.replace("/")}</script>'
                except APIError as exc:
                    title, detail, status, script = "Connection incomplete", exc.detail, exc.status, ""
                page = f'<!doctype html><meta charset="utf-8"><title>{html.escape(title)}</title><body style="background:#252d32;color:#d5dee3;font:16px system-ui;padding:50px"><h1>{html.escape(title)}</h1><p>{html.escape(detail)}</p><a href="/" style="color:#9dc961">Return to Trashlab</a>{script}</body>'
                return self._send(status, page, "text/html; charset=utf-8")
            if path.startswith("/api/"):
                raise APIError(404, "not_found", "Unknown API endpoint.")
            relative = path.lstrip("/") or "index.html"
            requested = (self.client.root / relative).resolve()
            try:
                resolved_relative = requested.relative_to(self.client.root)
            except ValueError:
                raise APIError(404, "not_found", "File not found.") from None
            if any(part.startswith(".") for part in Path(relative).parts) or any(part.startswith(".") for part in resolved_relative.parts) or requested.suffix.lower() not in STATIC_TYPES or not requested.is_file():
                raise APIError(404, "not_found", "File not found.")
            content_type = {".md": "text/plain", ".ttf": "font/ttf"}.get(requested.suffix.lower()) or mimetypes.guess_type(str(requested))[0] or "application/octet-stream"
            if content_type.startswith("text/") or requested.suffix in {".js", ".json", ".svg"}:
                content_type += "; charset=utf-8"
            self._send(200, requested.read_bytes(), content_type)
        except APIError as exc:
            self._error(exc)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self._error(APIError(500, "internal_error", "The local bridge could not complete this request."))

    def do_POST(self):
        if self._fs_proxy_request("POST"):
            return
        try:
            self._check_request(mutate=True)
            path = urllib.parse.urlsplit(self.path).path
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                raise APIError(400, "invalid_request", "Invalid request body length.") from None
            if length < 0 or length > MAX_BODY:
                raise APIError(413, "request_too_large", "Request body exceeds the size limit.")
            if length and self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                raise APIError(415, "invalid_content_type", "Send API requests as application/json.")
            try:
                payload = json.loads(self.rfile.read(length)) if length else {}
            except ValueError:
                raise APIError(400, "invalid_json", "Request body must be valid JSON.") from None
            if not isinstance(payload, dict):
                raise APIError(400, "invalid_request", "Request body must be a JSON object.")
            if path == "/api/workspace":
                return self._json(self.client.workspace_context(payload))
            if path == "/api/diagnostics/client":
                record_client_log(payload)
                return self._json({"ok": True})
            if path == "/api/studio":
                # A browser conditional read sends If-None-Match on this POST; it is
                # forwarded only for typed GETs that declare an ETag (see transport).
                conditional = self.headers.get("If-None-Match")
                if isinstance(payload, dict) and isinstance(conditional, str) and conditional and "ifNoneMatch" not in payload:
                    from studio_api_transport import etag_conditional_read
                    api = getattr(self.client, "studio_api", None)
                    operation = api.operations.get(payload.get("operationId")) if api is not None and isinstance(payload.get("operationId"), str) else None
                    if etag_conditional_read(operation):
                        payload = {**payload, "ifNoneMatch": conditional}
                result = self.client.studio_call(payload)
                if isinstance(result.get("binary"), bytes):
                    # Plugin editor frame (image/jpeg): bytes pass through unlogged.
                    return self._send(result["status"], result["binary"], result["contentType"], extra_headers=result["headers"])
                body = b"" if result["status"] in (204, 304) else json.dumps(result["data"], allow_nan=False).encode()
                return self._send(result["status"], body, extra_headers=result["headers"])
            if path == "/api/media/prepare":
                return self._json(self.client.prepare_media(payload))
            if path == "/api/auth/start":
                return self._json(self.client.start_auth())
            if path == "/api/auth/disconnect":
                return self._json(self.client.disconnect())
            if path == "/api/call":
                return self._json(self.client.call(payload.get("name"), payload.get("arguments", {}), idempotency_key=payload.get("idempotencyKey"), if_match=payload.get("ifMatch"),
                                                   priority="background" if payload.get("priority") == "background" else None))
            raise APIError(404, "not_found", "Unknown API endpoint.")
        except APIError as exc:
            self._error(exc)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self._error(APIError(500, "internal_error", "The local bridge could not complete this request."))


def make_server(port=8080, root=ROOT):
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), StudioHandler)
    server.freestyle = FreestyleClient(root, server.server_port)
    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8086)
    args = parser.parse_args()
    try:
        server = make_server(args.port)
    except OSError as exc:
        parser.exit(1, f"Could not start Trashlab on port {args.port}: {exc}\n")
    print(f"Trashlab: http://127.0.0.1:{server.server_port}\nFreestyle cloud tools: connect a Pro account in the browser.\nPress Ctrl+C to stop.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
