#!/usr/bin/env python3
"""Modesty's loopback-only static host and Freestyle OAuth/MCP bridge.

Run: python3 server.py [--port 8080]
Credentials stay in .local/freestyle-auth.json (0600); the browser never gets them.
Only the Python standard library is required.
"""
from __future__ import annotations

from studio_api_client import StudioApiClient, StudioApiResponse, StudioApiError, StudioApiPlanningError, BINARY_OPERATIONS
from studio_api_adapter import StudioApiAdapter, StudioOperationError
from studio_api_capabilities import studio_tools, studio_features, AI_NAMES
from studio_api_realtime import NativeSnapshotSessionManager, NativeSnapshotError
from tools.generate_studio_api_client import generate as generate_studio_manifest

import argparse
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
import sys
import threading
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parent
DEFAULT_BASE = "https://freestyle.audio"
BASE = (os.environ.get("FREESTYLE_BASE") or DEFAULT_BASE).rstrip("/")
_base_parts = urllib.parse.urlsplit(BASE)
if _base_parts.scheme != "https" and _base_parts.hostname not in ("127.0.0.1", "localhost", "::1"):
    raise SystemExit("FREESTYLE_BASE must be an https:// Freestyle origin (http only for loopback).")
MCP_URL = BASE + "/api/mcp"
SCOPES = "profile:read projects:list projects:read projects:write daw:read daw:write ai:use audio:listen exports:read media:upload library:read library:write offline_access"
MAX_BODY = 36 * 1024 * 1024
MAX_REMOTE = 40 * 1024 * 1024
MAX_MEDIA_BYTES = 32 * 1024 * 1024
MAX_MEDIA_RANGE = 16 * 1024 * 1024
MEDIA_PREVIEW_PATH = re.compile(r"/api/marketplace/[A-Za-z0-9_/-]+")
STATIC_TYPES = {".html", ".css", ".js", ".mjs", ".json", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".ico", ".wav", ".mp3", ".ogg", ".txt", ".md", ".woff", ".woff2", ".ttf", ".map"}


def verified_tls_context():
    """Framework Python on macOS can lack its bundled CA installation.

    Use the operating system's published CA bundle in that case, retaining
    certificate verification and hostname checks. Explicit user CA settings win.
    """
    context = ssl.create_default_context()
    bundle = Path("/etc/ssl/cert.pem")
    if (sys.platform == "darwin" and not os.environ.get("SSL_CERT_FILE")
            and not os.environ.get("SSL_CERT_DIR")
            and context.cert_store_stats().get("x509_ca", 0) == 0 and bundle.is_file()):
        context.load_verify_locations(cafile=str(bundle))
    return context


class APIError(Exception):
    def __init__(self, status, error, detail=None, metadata=None):
        super().__init__(detail or error)
        self.status, self.error, self.detail = status, error, detail or error
        self.metadata = safe_error_fields(metadata) if metadata else {}


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
# Response headers kept from Freestyle (plugin editor frames add X-Editor-*).
UPSTREAM_HEADERS = ("etag", "x-request-id", "retry-after", "content-type", "x-editor-revision", "x-editor-width",
                    "x-editor-height", "x-editor-plugin-instance-id", "x-editor-plugin-type")


def safe_error_details(value, depth=0):
    """Keep structured conflict diagnostics without credentials or response bodies."""
    if depth > 4:
        return None
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value if math.isfinite(value) else None
    if isinstance(value, str):
        return clean_message(value) if len(value) <= 1600 and not re.search(r"<\s*/?\s*[A-Za-z][^>]*>", value) else None
    if isinstance(value, list):
        return [safe_error_details(item, depth + 1) for item in value[:32]]
    if isinstance(value, dict):
        blocked = re.compile(r"token|secret|password|credential|authorization|cookie|headers|body|sdp|ticket|signature", re.I)
        return {key: safe_error_details(item, depth + 1) for key, item in list(value.items())[:32]
                if isinstance(key, str) and re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", key) and not blocked.search(key)}
    return None


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
        # Production failures distinguish validation, routing and engine
        # dispatch. Keep these bounded diagnostics through the local bridge.
        stage = item.get("stage")
        if isinstance(stage, str) and re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", stage) and clean_message(stage) == stage:
            fields["stage"] = stage
        engine_status = item.get("engineStatus")
        if isinstance(engine_status, int) and not isinstance(engine_status, bool) and 0 <= engine_status <= 599:
            fields["engineStatus"] = engine_status
        elif isinstance(engine_status, str) and re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", engine_status) and clean_message(engine_status) == engine_status:
            fields["engineStatus"] = engine_status
        request_id = item.get("requestId")
        if isinstance(request_id, str) and re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", request_id) and clean_message(request_id) == request_id:
            fields["requestId"] = request_id
        if isinstance(item.get("details"), (dict, list)):
            details = safe_error_details(item["details"])
            if len(json.dumps(details)) <= 8192:
                fields["details"] = details
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
        if isinstance(item.get("retryable"), bool):
            fields["retryable"] = item["retryable"]
        if isinstance(item.get("rpcCode"), int) and not isinstance(item["rpcCode"], bool) and -(2 ** 31) <= item["rpcCode"] < 2 ** 31:
            fields["rpcCode"] = item["rpcCode"]
        # MCP can retain its normal result envelope even on an HTTP 4xx.
        # Inspect only explicitly failed tool results, never successful payloads.
        result = item.get("result")
        if isinstance(result, dict) and result.get("isError") is True:
            visit(result, depth + 1)
        if item.get("isError") is True:
            visit(item.get("structuredContent"), depth + 1)
            if not isinstance(item.get("structuredContent"), dict):
                content = item.get("content")
                if isinstance(content, list):
                    for block in content[:16]:
                        if isinstance(block, dict) and block.get("type") == "text":
                            text = block.get("text")
                            if isinstance(text, str) and text.lstrip().startswith("{"):
                                visit(text, depth + 1)
        # Only named error containers are considered, with a fixed depth bound.
        for key in ("error", "data", "response", "detail", "details", "cause", "body", "message", "error_description"):
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
        return http.client.HTTPSConnection(parts.netloc, timeout=90, context=verified_tls_context())
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
        self._credential_depth = 0
        self._store_seen = self.store.exists()
        self.pending = {}
        self.media_tickets = {}
        self.tls_context = None
        self.sequence = 0
        self.audio_device_id = str(uuid.uuid4())
        self.initialized = False
        self.live_tools = None
        self.studio_client = None
        self.studio_adapter = None
        self.studio_realtime = None
        self.studio_schema_hash = None
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

    def _request(self, url, payload=None, form=False, bearer=None, timeout=120, extra_headers=None, method=None, return_response=False):
        headers = {"Accept": "application/json", "User-Agent": "VegetableStudio/1.0"}
        body = None
        if payload is not None:
            body = (urllib.parse.urlencode(payload).encode() if form else json.dumps(payload).encode())
            headers["Content-Type"] = "application/x-www-form-urlencoded" if form else "application/json"
        if bearer:
            headers["Authorization"] = "Bearer " + bearer
            if urllib.parse.urlsplit(url).path == "/api/mcp":
                headers["Accept"] = "application/json, text/event-stream"
                headers["MCP-Protocol-Version"] = "2025-11-25"
        if extra_headers:
            headers.update(extra_headers)
        request = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            context = None
            if urllib.parse.urlsplit(url).scheme == "https":
                if self.tls_context is None:
                    self.tls_context = verified_tls_context()
                context = self.tls_context
            with urllib.request.urlopen(request, timeout=timeout, context=context) as response:
                raw = response.read(MAX_REMOTE + 1)
                content_type = response.headers.get("Content-Type", "application/json")
                response_status = response.status
                response_headers = {k: v for k, v in response.headers.items() if k.lower() in UPSTREAM_HEADERS}
        except urllib.error.HTTPError as exc:
            if return_response:
                raw = exc.read(MAX_ERROR_BODY + 1)
                status = exc.code
                response_headers = {k: v for k, v in exc.headers.items() if k.lower() in UPSTREAM_HEADERS}
                content_type = exc.headers.get("Content-Type", "application/json")
                exc.close()
                if len(raw) > MAX_ERROR_BODY:
                    raise APIError(502, "response_too_large", "Freestyle error response exceeded the local bridge's size limit.")
                return raw, content_type, status, response_headers
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
            raise APIError(502, "freestyle_unreachable", "Could not reach Freestyle. Check your connection and try again.") from exc
        if len(raw) > MAX_REMOTE:
            raise APIError(502, "response_too_large", "Freestyle response exceeded the local bridge's size limit.")
        if return_response:
            return raw, content_type, response_status, response_headers
        return raw, content_type

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
                "scopes": self.data.get("scope", "").split(), "toolsCount": len(studio_tools(self.studio_adapter)) if self.studio_adapter is not None else len(self.live_tools or self.documented_tools),
                "deterministicTransport": "studio-api-v1",
                "requiresPro": True, "authUrl": "/api/auth/start"}

    @staticmethod
    def _bounded_string(value, maximum, label):
        if not isinstance(value, str) or not value or len(value) > maximum or re.search(r"[\x00-\x1f\x7f]", value):
            raise APIError(400, "invalid_audio_arguments", f"Provide a valid {label} of at most {maximum} characters.")
        return value

    def prepare_media(self, payload):
        url = payload.get("url")
        if not isinstance(url, str) or len(url) > 2048:
            raise APIError(400, "invalid_media_url", "Choose an audio preview URL returned by the Freestyle library.")
        try:
            parsed = urllib.parse.urlsplit(url)
            allowed = (parsed.scheme == "https" and parsed.hostname == "freestyle.audio" and parsed.port in (None, 443)
                and not parsed.username and not parsed.password and not parsed.query and not parsed.fragment
                and MEDIA_PREVIEW_PATH.fullmatch(parsed.path))
        except ValueError:
            allowed = False
        if not allowed:
            raise APIError(400, "invalid_media_url", "Only the observed Freestyle library audio preview routes are supported.")
        self._access_token()
        now = time.time()
        with self.lock:
            self.media_tickets = {key: item for key, item in self.media_tickets.items() if item["expires"] > now}
            while len(self.media_tickets) >= 128:
                del self.media_tickets[next(iter(self.media_tickets))]
            ticket = secrets.token_urlsafe(24)
            self.media_tickets[ticket] = {"url": url, "expires": now + 300}
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
        headers = {"Accept": "audio/*", "User-Agent": "VegetableStudio/1.0", "Authorization": "Bearer " + self._access_token()}
        if requested_range:
            headers["Range"] = requested_range
        request = urllib.request.Request(item["url"], headers=headers, method="HEAD" if head else "GET")
        opener = urllib.request.build_opener(NoMediaRedirect())
        try:
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
                    detail = clean_message(candidate)
            except (ValueError, OSError):
                pass
            status = exc.code if exc.code in (400, 401, 403, 404, 416, 429) else 502
            raise APIError(status, "media_upstream_error", detail) from None
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
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
        path = self.root / ".local" / "workspace-context.json"
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
                    "client_name": "Modesty (local browser DAW)",
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
                raise APIError(400, "invalid_oauth_state", "This connection request expired or could not be verified. Connect again from Modesty.")
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
            out["User-Agent"] = "modesty-bridge/1.0"
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
                self._rpc("initialize", {"protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": "modesty", "version": "1.0.0"}})
                self.initialized = True

    def mcp_tools(self, refresh=False):
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

    def mcp_call(self, name, arguments):
        if not isinstance(name, str) or not name or len(name) > 160 or not re.fullmatch(r"[A-Za-z0-9_.-]+", name):
            raise APIError(400, "invalid_tool", "Provide a valid Freestyle tool name.")
        if not isinstance(arguments, dict):
            raise APIError(400, "invalid_arguments", "Tool arguments must be a JSON object.")
        self.initialize()
        if self.live_tools is not None and name not in {tool.get("name") for tool in self.live_tools}:
            # New upstream tools can appear while this browser/server stays open.
            # Refresh the authoritative registry before rejecting a new name.
            discovered = self.mcp_tools(refresh=True)["tools"]
            if name not in {tool.get("name") for tool in discovered}:
                raise APIError(400, "unknown_tool", "This tool is not advertised by the current Freestyle registry. Refresh the tool list or check its name.")
        return self._rpc("tools/call", {"name": name, "arguments": arguments})

    def _studio_transport(self, request):
        parsed = urllib.parse.urlsplit(request.url)
        if parsed.scheme != "https" or parsed.netloc != "freestyle.audio" or not parsed.path.startswith("/api/v1/"):
            raise APIError(400, "invalid_studio_target", "Studio requests must use Freestyle's versioned API.")
        token = self._access_token()
        # Keep credentials out of the immutable request and retained receipts.
        for attempt in range(2):
            raw, content_type, status, headers = self._request(request.url, request.body,
                bearer=token, method=request.method, extra_headers=dict(request.headers), return_response=True)
            if status != 401 or attempt:
                break
            token = self._access_token(force_refresh=True, rejected_token=token)
        media = str(content_type or "").split(";")[0].strip().lower()
        if 200 <= status < 300 and media.startswith("image/"):
            # Binary editor frames pass through as bytes with their headers.
            if media != BINARY_OPERATIONS.get(request.operation_id):
                raise APIError(502, "invalid_studio_response", "Freestyle returned an unexpected image response.")
            return StudioApiResponse(status, raw, headers)
        if status == 304:
            return StudioApiResponse(status, None, headers)
        try:
            data = json.loads(raw) if raw else None
        except (ValueError, UnicodeDecodeError):
            raise APIError(502, "invalid_studio_response", "Freestyle Studio API returned invalid JSON.") from None
        return StudioApiResponse(status, data, headers)

    def _ensure_studio(self, refresh=False):
        with self.lock:
            spec = None
            if refresh:
                spec = self._json_request(BASE + "/api/v1/openapi.json")
                manifest = generate_studio_manifest(spec)
                if self.studio_adapter is not None and manifest["schema_sha256"] == self.studio_schema_hash:
                    return self.studio_adapter
            elif self.studio_adapter is not None:
                return self.studio_adapter
            else:
                with ((self.root / "docs" / "studio-openapi.json") if (self.root / "docs" / "studio-openapi.json").exists() else (ROOT / "docs" / "studio-openapi.json")).open() as handle:
                    spec = json.load(handle)
                manifest = generate_studio_manifest(spec)
            client = StudioApiClient(transport=self._studio_transport, manifest=manifest)
            if self.studio_client is not None:
                client.inherit_retained_requests(self.studio_client)
            # Registry discovery must not revoke an editor's existing tickets
            # or lose ownership of them. Only the request planner changes.
            realtime = self.studio_realtime
            if realtime is None:
                realtime = NativeSnapshotSessionManager(client.call, ssl_context=verified_tls_context())
            else:
                realtime.call = client.call
            adapter = StudioApiAdapter(client, snapshot_reader=realtime.native_snapshot, spec=spec)
            self.studio_client, self.studio_adapter, self.studio_realtime = client, adapter, realtime
            self.studio_schema_hash = manifest["schema_sha256"]
            return adapter

    def tools(self, refresh=False):
        adapter = self._ensure_studio(refresh=refresh)
        return {"connected": self.status()["connected"], "source": "live" if self.status()["connected"] else "documentation", "transport": "studio-api-v1",
            "schemaSource": "studio-openapi", "schemaSha256": self.studio_schema_hash,
            "features": studio_features(adapter), "tools": studio_tools(adapter, self.documented_tools)}

    def call(self, name, arguments):
        if not isinstance(name, str) or not name or len(name) > 160 or not re.fullmatch(r"[A-Za-z0-9_.-]+", name):
            raise APIError(400, "invalid_tool", "Provide a valid Studio operation name.")
        if not isinstance(arguments, dict):
            raise APIError(400, "invalid_arguments", "Studio arguments must be a JSON object.")
        if name in AI_NAMES:
            return self.mcp_call(name, arguments)
        if not self.status()["connected"]:
            raise APIError(401, "authorization_required", "Connect a Freestyle Pro account to use Studio API editing.")
        try:
            adapter = self._ensure_studio()
            data = adapter.call(name, arguments)
            # Local response compatibility only; no outbound MCP call occurs.
            result = {"structuredContent": data, "content": [{"type": "text", "text": json.dumps(data)}],
                "isError": False, "transport": "studio-api-v1"}
            etag = adapter.last_etag() if hasattr(adapter, "last_etag") else None
            if isinstance(etag, str) and etag and not re.search(r"[\r\n]", etag):
                result["etag"] = etag
            return result
        except StudioApiError as error:
            metadata = {"code": error.code, "stage": error.stage, "engineStatus": error.engine_status,
                "requestId": error.request_id, "details": error.details, "upstreamStatus": error.status}
            raise APIError(error.status, "studio_api_error", error.message, metadata=metadata) from None
        except (StudioOperationError, NativeSnapshotError) as error:
            metadata = {"code": error.code, "stage": getattr(error, "stage", "studio_adapter")}
            if getattr(error, "details", None) is not None:
                metadata["details"] = error.details
            raise APIError(error.status, error.code, str(error), metadata=metadata) from None
        except StudioApiPlanningError as error:
            raise APIError(400, "studio_request_invalid", str(error), metadata={"code": error.code, "stage": "studio_preflight"}) from None

    def editor_frame(self, query):
        """GET /api/editor/frame: the published getPluginEditorFrame read,
        returned as raw image bytes (or a bodiless 304) with editor headers."""
        def one(name):
            values = query.get(name)
            return values[-1] if values else None
        arguments = {}
        for name in ("project_id", "lane_id"):
            value = one(name)
            if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value):
                raise APIError(400, "invalid_editor_context", "Provide valid project and persisted lane IDs.")
            arguments[name] = value
        for name, low, high, required in (("plugin_index", 0, 64, True), ("max_width", 64, 1280, False), ("wait_ms", 0, 500, False)):
            value = one(name)
            if value is None and not required:
                continue
            if value is None or not re.fullmatch(r"\d{1,5}", value) or not low <= int(value) <= high:
                raise APIError(400, "invalid_editor_arguments", f"{name} must be an integer from {low} to {high}.")
            arguments[name] = int(value)
        for name in ("if_revision", "expected_plugin_instance_id"):
            value = one(name)
            if value is not None:
                self._bounded_string(value, 128, name)
                arguments[name] = value
        if not self.status()["connected"]:
            raise APIError(401, "authorization_required", "Connect a Freestyle Pro account to use Studio API editing.")
        try:
            return self._ensure_studio().editor_frame(arguments)
        except StudioApiError as error:
            metadata = {"code": error.code, "stage": error.stage, "engineStatus": error.engine_status,
                "requestId": error.request_id, "details": error.details, "upstreamStatus": error.status}
            raise APIError(error.status, "studio_api_error", error.message, metadata=metadata) from None
        except (StudioOperationError, NativeSnapshotError) as error:
            raise APIError(error.status, error.code, str(error), metadata={"code": error.code, "stage": "studio_adapter"}) from None
        except StudioApiPlanningError as error:
            raise APIError(400, "studio_request_invalid", str(error), metadata={"code": error.code, "stage": "studio_preflight"}) from None

    def disconnect(self):
        if self.studio_realtime is not None:
            self.studio_realtime.close()
        self.studio_realtime = self.studio_adapter = self.studio_client = None
        self.studio_schema_hash = None
        with self._credential_store():
            if self.data.get("refresh_token"):
                self._json_request(BASE + "/api/oauth/revoke", {"token": self.data["refresh_token"], "client_id": self.data["client_id"]}, form=True)
            self.data = {"client_id": self.data["client_id"]} if self.data.get("client_id") else {}
            self.environment_token, self.live_tools, self.initialized = None, None, False
            self.media_tickets.clear()
            self._save()
            return self.status()


class StudioHandler(http.server.BaseHTTPRequestHandler):
    server_version = "VegetableStudio/1.0"

    @property
    def client(self):
        return self.server.freestyle

    def log_message(self, fmt, *args):
        # Callback query strings contain one-use authorization codes.
        path = urllib.parse.urlsplit(self.path).path
        if path.startswith("/api/media/"):
            path = "/api/media/[ticket]"
        # Log time = completion; also record start offset and duration so slow upstream steps are visible.
        t0 = getattr(self, "_t0", None)
        timing = ""
        if t0 is not None:
            timing = f" started={time.strftime('%H:%M:%S', time.localtime(t0))}.{int((t0 % 1) * 1000):03d} dur={int((time.time() - t0) * 1000)}ms"
        name = getattr(self, "_log_name", None)
        label = f" {name}" if isinstance(name, str) and len(name) <= 80 else ""
        print(f"[{self.log_date_time_string()}] {self.command} {path}{label}{timing}", flush=True)

    def parse_request(self):
        self._t0 = time.time()
        self._log_name = None
        return super().parse_request()

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
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
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

    def _editor_frame(self, frame):
        body = frame["bytes"] or b""
        self.send_response(frame["status"])
        if frame["status"] != 304:
            self.send_header("Content-Type", frame.get("contentType") or "image/jpeg")
        self.send_header("Content-Length", str(len(body)))
        for name, key in (("ETag", "etag"), ("X-Editor-Revision", "revision"), ("X-Editor-Width", "width"),
                          ("X-Editor-Height", "height"), ("X-Editor-Plugin-Instance-Id", "pluginInstanceId"),
                          ("X-Editor-Plugin-Type", "pluginType")):
            value = frame.get(key)
            if value is not None and not re.search(r"[\r\n]", str(value)):
                self.send_header(name, str(value))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.end_headers()
        if self.command != "HEAD" and body:
            self.wfile.write(body)

    def _json(self, data, status=200):
        self._send(status, json.dumps(data))

    def _error(self, exc):
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
            if path == "/api/tools":
                refresh = urllib.parse.parse_qs(parsed.query).get("refresh") == ["1"]
                return self._json(self.client.tools(refresh=refresh))
            if path == "/api/workspace":
                return self._json(self.client.workspace_context())
            if path.startswith("/api/media/"):
                return self._proxy_media(path[len("/api/media/"):])
            if path == "/api/editor/frame":
                return self._editor_frame(self.client.editor_frame(urllib.parse.parse_qs(parsed.query)))
            if path == "/api/auth/callback":
                try:
                    self.client.finish_auth(urllib.parse.parse_qs(parsed.query))
                    title, detail, status = "Freestyle connected", "You can return to Modesty. This window will close automatically.", 200
                    script = '<script>if(window.opener){window.opener.postMessage("freestyle-connected",location.origin);window.close()}else{location.replace("/")}</script>'
                except APIError as exc:
                    title, detail, status, script = "Connection incomplete", exc.detail, exc.status, ""
                page = f'<!doctype html><meta charset="utf-8"><title>{html.escape(title)}</title><body style="background:#252d32;color:#d5dee3;font:16px system-ui;padding:50px"><h1>{html.escape(title)}</h1><p>{html.escape(detail)}</p><a href="/" style="color:#9dc961">Return to Modesty</a>{script}</body>'
                return self._send(status, page, "text/html; charset=utf-8")
            if path.startswith("/api/"):
                raise APIError(404, "not_found", "Unknown API endpoint.")
            relative = path.lstrip("/") or "index.html"
            requested = (self.client.root / relative).resolve()
            try:
                resolved_parts = requested.relative_to(self.client.root).parts
            except ValueError:
                raise APIError(404, "not_found", "File not found.") from None
            if any(part.startswith(".") for part in Path(relative).parts) or any(part.startswith(".") for part in resolved_parts) or requested.suffix.lower() not in STATIC_TYPES or not requested.is_file():
                raise APIError(404, "not_found", "File not found.")
            content_type = {".md": "text/plain", ".ttf": "font/ttf"}.get(requested.suffix.lower()) or mimetypes.guess_type(str(requested))[0] or "application/octet-stream"
            if content_type.startswith("text/") or requested.suffix in {".js", ".json", ".svg"}:
                content_type += "; charset=utf-8"
            self._send(200, requested.read_bytes(), content_type)
        except APIError as exc:
            self._error(exc)
        except (StudioApiError, StudioOperationError, NativeSnapshotError) as error:
            self._error(APIError(error.status, error.code, str(error), metadata={"code": error.code, "stage": "realtime"}))
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self._error(APIError(500, "internal_error", "The local bridge could not complete this request."))

    def do_DELETE(self):
        if self._fs_proxy_request("DELETE"):
            return
        try:
            self._check_request(mutate=True)
            path = urllib.parse.urlsplit(self.path).path
            match = re.fullmatch(r"/api/realtime/session/([A-Za-z0-9_-]{1,128})", path)
            if not match:
                raise APIError(404, "not_found", "Unknown API endpoint.")
            self.client._ensure_studio()
            return self._json(self.client.studio_realtime.close_browser_ticket(match.group(1)))
        except APIError as error:
            self._error(error)
        except (StudioApiError, StudioOperationError, NativeSnapshotError) as error:
            self._error(APIError(error.status, error.code, str(error), metadata={"code": error.code, "stage": "realtime"}))
        except (BrokenPipeError, ConnectionResetError):
            pass

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
            self._log_name = payload.get("name") if path == "/api/call" else None
            if path == "/api/workspace":
                return self._json(self.client.workspace_context(payload))
            if path == "/api/realtime/session":
                self.client._ensure_studio()
                return self._json(self.client.studio_realtime.create_browser_ticket(
                    payload.get("project_id"), "http://" + self.headers["Host"], payload.get("track_id")))
            if path == "/api/media/prepare":
                return self._json(self.client.prepare_media(payload))
            if path == "/api/auth/start":
                return self._json(self.client.start_auth())
            if path == "/api/auth/disconnect":
                return self._json(self.client.disconnect())
            if path == "/api/call":
                result = self.client.call(payload.get("name"), payload.get("arguments", {}))
                # Same-origin bridge (no CORS): the upstream ETag is forwarded as
                # the response ETag header and also as result.etag.
                etag = result.get("etag") if isinstance(result, dict) else None
                return self._send(200, json.dumps(result), extra_headers={"ETag": etag} if etag else None)
            raise APIError(404, "not_found", "Unknown API endpoint.")
        except APIError as exc:
            self._error(exc)
        except (StudioApiError, StudioOperationError, NativeSnapshotError) as error:
            self._error(APIError(error.status, error.code, str(error), metadata={"code": error.code, "stage": "realtime"}))
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
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()
    try:
        server = make_server(args.port)
    except OSError as exc:
        parser.exit(1, f"Could not start Modesty on port {args.port}: {exc}\n")
    print(f"Modesty: http://127.0.0.1:{server.server_port}\nFreestyle cloud tools: connect a Pro account in the browser.\nPress Ctrl+C to stop.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        if server.freestyle.studio_realtime is not None:
            server.freestyle.studio_realtime.close()
        server.server_close()


if __name__ == "__main__":
    main()
