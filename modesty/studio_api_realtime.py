"""Read-only Studio API realtime sessions; OAuth stays in the local bridge.

The REST API intentionally has no get_pro_state operation. Its documented
interactive snapshot is the authoritative native state, including runtime clip
and track handles. This bridge obtains that state without MCP or inventing
native handles from canonical database rows.
"""
import copy
import json
import ssl
import threading
import time
import uuid
from urllib.parse import urlsplit, urljoin


class NativeSnapshotError(Exception):
    def __init__(self, code, message, status=502):
        super().__init__(message)
        self.code = code
        self.stage = "realtime"
        self.status = status


def _opaque(value, label):
    if not isinstance(value, str) or not value or len(value) > 128 or any(ord(c) < 32 for c in value):
        raise NativeSnapshotError("invalid_realtime_context", "Provide a valid %s." % label, 400)
    return value


def _data(response):
    value = getattr(response, "data", response)
    if not isinstance(value, dict):
        raise NativeSnapshotError("invalid_realtime_session", "Studio API returned no realtime session object.")
    return value


def _websocket_url(value, origin):
    parsed_origin = urlsplit(origin)
    result = urljoin(origin.rstrip("/") + "/", value) if isinstance(value, str) else ""
    parsed = urlsplit(result)
    scheme = "wss" if parsed.scheme == "https" else parsed.scheme
    if (scheme != "wss" or parsed.hostname != parsed_origin.hostname or (parsed.port or 443) != (parsed_origin.port or 443)
            or parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.path != "/api/ws/mcp-session"):
        raise NativeSnapshotError("invalid_realtime_url", "Studio API returned an invalid realtime socket URL.")
    return parsed._replace(scheme="wss").geturl()


def _complete_container(container, name, allow_unavailable=False):
    def marked(value):
        if value is None or value is False or value == 0 or value == "":
            return False
        if isinstance(value, dict):
            return any(marked(child) for child in value.values())
        return True

    def visit(value):
        if isinstance(value, dict):
            for key, child in value.items():
                lower = str(key).lower()
                if (lower.startswith("_truncated") or lower == "truncated" or lower.endswith("truncated")) and marked(child):
                    raise NativeSnapshotError("incomplete_native_snapshot", "Studio API returned truncated native %s." % name)
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)
    visit(container)
    if isinstance(container, dict) and (container.get("ok") is False or container.get("error")):
        raise NativeSnapshotError("incomplete_native_snapshot", "Studio API returned no complete native %s." % name)
    if isinstance(container, dict) and container.get("unavailable"):
        if allow_unavailable:
            return False
        raise NativeSnapshotError("native_state_unavailable", "The project live engine has no available native %s snapshot." % name, 503)
    rows = container if isinstance(container, list) else container.get(name) if isinstance(container, dict) else None
    if not isinstance(rows, list) or isinstance(container, dict) and (container.get("ok") is False or container.get("error")):
        raise NativeSnapshotError("incomplete_native_snapshot", "Studio API returned no complete native %s." % name)
    return True


def _snapshot_state(frame, project_id):
    value = frame.get("state")
    if not isinstance(value, dict) or value.get("error") or value.get("ok") is False:
        raise NativeSnapshotError("invalid_native_snapshot", "Studio API returned no valid native state snapshot.")
    session = value.get("session") or {}
    if not isinstance(session, dict) or any(session.get(k) is not None and session[k] != project_id for k in ("projectId", "project_id")):
        raise NativeSnapshotError("foreign_native_snapshot", "The native snapshot belongs to another project.")
    # The root may budget unrelated capability descriptions. Only authoritative
    # audio membership must be complete for import/deletion/history guards.
    available = [_complete_container(value.get(name), name, allow_unavailable=True)
        for name in ("tracks", "clips")]
    if not all(available):
        raise NativeSnapshotError("native_state_unavailable", "The project live engine has no available native audio snapshot.", 503)
    return copy.deepcopy(value)


def _default_websocket_factory(url, timeout, ssl_context):
    try:
        import websocket
    except ImportError:
        raise NativeSnapshotError("realtime_dependency_unavailable", "Install websocket-client to read Studio API native snapshots.") from None
    return websocket.create_connection(url, timeout=timeout, suppress_origin=True,
        enable_multithread=True, sslopt={"context": ssl_context})


class _Connection:
    def __init__(self, project_id, track_id, session_id, socket):
        self.project_id, self.track_id, self.session_id, self.socket = project_id, track_id, session_id, socket
        self.condition = threading.Condition()
        self.version = 0
        self.state = None
        self.metadata = None
        self.error = None
        self.stopped = False
        self.thread = None


class NativeSnapshotSessionManager:
    """Own one persistent read-only session, with fresh snapshots on each read.

    call is StudioApiClient.call (or an equivalent callback accepting the same
    operation id/path/body/idempotency_key interface). The reader thread answers
    native WebSocket pings even between project edits. No command frames or
    OAuth token are ever sent to a browser or to an arbitrary socket host.
    """
    def __init__(self, call, origin="https://freestyle.audio", timeout=90,
            websocket_factory=None, ssl_context=None):
        self.call = call
        self.origin = origin.rstrip("/")
        self.timeout = timeout
        self.websocket_factory = websocket_factory or _default_websocket_factory
        self.ssl_context = ssl_context or ssl.create_default_context()
        self.lock = threading.RLock()
        self.connection = None
        self.browser_sessions = {}

    def _close_connection(self, connection):
        if connection is None:
            return
        with connection.condition:
            connection.stopped = True
            connection.condition.notify_all()
        try:
            connection.socket.send(json.dumps({"type": "close"}))
        except Exception:
            pass
        try:
            connection.socket.close()
        except Exception:
            pass
        # Only the exact session this manager opened is revoked. A rejected
        # close never makes a state snapshot look successful.
        try:
            self.call("closeInteractiveSession", path={"session_id": connection.session_id},
                idempotency_key=str(uuid.uuid4()))
        except Exception:
            pass
        if connection.thread is not None and connection.thread is not threading.current_thread():
            connection.thread.join(timeout=1)

    def close(self):
        with self.lock:
            connection, self.connection = self.connection, None
            self._close_connection(connection)
            for session_id in list(self.browser_sessions):
                try:
                    self.close_browser_ticket(session_id)
                except Exception:
                    pass

    def _reader(self, connection):
        try:
            while not connection.stopped:
                try:
                    raw = connection.socket.recv()
                except Exception as error:
                    if isinstance(error, TimeoutError) or type(error).__name__ in ("WebSocketTimeoutException", "timeout"):
                        continue
                    raise
                if not isinstance(raw, (str, bytes)) or not raw:
                    raise NativeSnapshotError("realtime_closed", "The native state channel closed.")
                if len(raw) > 8 * 1024 * 1024:
                    raise NativeSnapshotError("realtime_frame_too_large", "The native state snapshot exceeded the bridge response limit.")
                try:
                    frame = json.loads(raw)
                except (ValueError, UnicodeError):
                    raise NativeSnapshotError("invalid_realtime_frame", "Studio API returned an invalid realtime frame.") from None
                if not isinstance(frame, dict):
                    raise NativeSnapshotError("invalid_realtime_frame", "Studio API returned an invalid realtime frame.")
                if frame.get("project_id") is not None and frame["project_id"] != connection.project_id:
                    raise NativeSnapshotError("foreign_native_snapshot", "The native state channel belongs to another project.")
                kind = frame.get("type")
                if kind == "welcome" and (frame.get("session_id") != connection.session_id or frame.get("mode", "read") != "read"):
                    raise NativeSnapshotError("foreign_native_snapshot", "The native channel welcome does not match its read-only session.")
                if kind == "snapshot":
                    state = _snapshot_state(frame, connection.project_id)
                    with connection.condition:
                        connection.state = state
                        connection.metadata = {key: frame.get(key) for key in ("epoch", "revision", "reason")}
                        connection.version += 1
                        connection.condition.notify_all()
                elif kind in ("session_closed", "error", "reject"):
                    raise NativeSnapshotError("realtime_closed", "The native state session was closed or rejected.")
                # This channel deliberately carries no edit commands. Patches
                # are not fabricated into native runtime observations; a fresh
                # snapshot_request is sent whenever a caller needs readback.
        except Exception as error:
            with connection.condition:
                if not connection.stopped:
                    connection.error = error if isinstance(error, NativeSnapshotError) else NativeSnapshotError(
                        "realtime_unavailable", "The native state channel became unavailable.")
                connection.condition.notify_all()

    def _wait(self, connection, previous_version):
        end = time.monotonic() + self.timeout
        with connection.condition:
            while connection.version <= previous_version and connection.error is None and not connection.stopped:
                remaining = end - time.monotonic()
                if remaining <= 0:
                    raise NativeSnapshotError("native_snapshot_timeout", "Studio API did not return a fresh native snapshot.")
                connection.condition.wait(remaining)
            if connection.error is not None:
                raise connection.error
            if connection.stopped or connection.state is None:
                raise NativeSnapshotError("realtime_closed", "The native state channel closed before readback.")
            return copy.deepcopy(connection.state)

    def _open(self, project_id, track_id):
        body = {"mode": "read"}
        if track_id:
            body["track_id"] = track_id
        opened = _data(self.call("openInteractiveSession", path={"project_id": project_id}, body=body))
        try:
            session_id = _opaque(opened.get("session_id"), "native session id")
        except NativeSnapshotError:
            raise NativeSnapshotError("invalid_realtime_session", "Studio API returned no valid native session id.") from None
        socket = None
        connection = None
        try:
            if opened.get("mode", "read") != "read":
                raise NativeSnapshotError("invalid_realtime_session", "Studio API did not create the requested read-only session.")
            ticket = opened.get("session_ticket")
            if not isinstance(ticket, str) or not ticket or len(ticket) > 16384:
                raise NativeSnapshotError("invalid_realtime_session", "Studio API returned no usable native session ticket.")
            url = _websocket_url(opened.get("websocket_url"), self.origin)
            socket = self.websocket_factory(url, min(self.timeout, 5), self.ssl_context)
            connection = _Connection(project_id, track_id, session_id, socket)
            self.connection = connection
            socket.send(json.dumps({"type": "auth", "ticket": ticket}))
            # Native WebSocket ping/pong is handled by the reader. Polling the
            # engine clock is unnecessary here: the audio peer already carries
            # a pushed clock, and REST has a dedicated fast clock endpoint.
            socket.send(json.dumps({"type": "subscribe", "clock": False}))
            connection.thread = threading.Thread(target=self._reader, args=(connection,), daemon=True,
                name="modesty-studio-native-state")
            connection.thread.start()
            return connection
        except Exception:
            if connection is not None:
                self._close_connection(connection)
            else:
                if socket is not None:
                    try:
                        socket.close()
                    except Exception:
                        pass
                try:
                    self.call("closeInteractiveSession", path={"session_id": session_id}, idempotency_key=str(uuid.uuid4()))
                except Exception:
                    pass
            self.connection = None
            raise

    def _native_snapshot_once(self, project_id, track_id=None):
        project_id = _opaque(project_id, "project id")
        if track_id is not None:
            track_id = _opaque(track_id, "track id")
        with self.lock:
            connection = self.connection
            if connection is not None and (connection.project_id != project_id or connection.track_id != track_id or connection.error is not None):
                self.connection = None
                self._close_connection(connection)
                connection = None
            try:
                if connection is None:
                    connection = self._open(project_id, track_id)
                    return self._wait(connection, 0)
                with connection.condition:
                    version = connection.version
                connection.socket.send(json.dumps({"type": "snapshot_request"}))
                return self._wait(connection, version)
            except Exception:
                if self.connection is connection:
                    self.connection = None
                self._close_connection(connection)
                raise

    def _warm_project(self, project_id, track_id):
        # The transport endpoint may return an empty device-ready engine. The
        # monitor bootstrap explicitly opens the project's actual Mozart audio
        # session, without starting playback or opening a WebRTC peer.
        project = _data(self.call("getProject", path={"project_id": project_id}))
        if project.get("error") or project.get("ok") is False:
            raise NativeSnapshotError("native_bootstrap_failed", "Studio API could not read the project for audio bootstrap.")
        if project.get("id") != project_id:
            raise NativeSnapshotError("foreign_native_snapshot", "The bootstrap project belongs to another project.")
        clips, lanes = project.get("clips"), project.get("lanes")
        flags, counts = project.get("truncated", {}), project.get("counts", {})
        for name, rows in (("clips", clips), ("lanes", lanes)):
            truncated = flags is True or isinstance(flags, dict) and bool(flags.get(name))
            count = counts.get(name) if isinstance(counts, dict) else None
            if (not isinstance(rows, list) or truncated
                    or count is not None and (type(count) is not int or count != len(rows))):
                raise NativeSnapshotError("incomplete_native_snapshot", "Studio API returned incomplete bootstrap %s." % name)
            seen = set()
            for row in rows:
                if not isinstance(row, dict) or row.get("error") or row.get("ok") is False:
                    raise NativeSnapshotError("incomplete_native_snapshot", "Studio API returned invalid bootstrap %s." % name)
                for key in ("project_id", "projectId"):
                    if row.get(key) is not None and row[key] != project_id:
                        raise NativeSnapshotError("foreign_native_snapshot", "The bootstrap audio belongs to another project.")
                identity = _opaque(row.get("id"), "persisted %s id" % name)
                if identity in seen:
                    raise NativeSnapshotError("incomplete_native_snapshot", "Studio API returned duplicate bootstrap %s ids." % name)
                seen.add(identity)
        lane_ids = {lane["id"] for lane in lanes}
        if any(not isinstance(clip.get("laneId"), str) or clip["laneId"] not in lane_ids for clip in clips):
            raise NativeSnapshotError("incomplete_native_snapshot", "Studio API returned bootstrap audio without an existing lane.")
        source = next((clip for clip in clips if clip["id"] == track_id), None)
        if source is None and track_id:
            if not any(lane["id"] == track_id for lane in lanes):
                raise NativeSnapshotError("invalid_realtime_context", "The requested audio context is not in this project.", 400)
            source = next((clip for clip in clips if clip.get("laneId") == track_id), None)
        source = source or next(iter(clips), None)
        body = {"track_id": source["id"]} if source is not None else {}
        # One logical bootstrap, one retained key; no automatic mutation retry.
        # Its receipt is never used as a substitute for native WS readback.
        key = str(uuid.uuid4())
        opened = _data(self.call("startAudioMonitor", path={"project_id": project_id},
            body=body, idempotency_key=key))
        session = opened.get("session")
        if (opened.get("error") or opened.get("ok") is False or not isinstance(session, dict)
                or session.get("error") or session.get("ok") is False or session.get("unavailable")):
            raise NativeSnapshotError("native_bootstrap_failed", "Studio API could not open the project's live audio session.")
        if any(value.get(k) is not None and value[k] != project_id
                for value in (opened, session) for k in ("project_id", "projectId")):
            raise NativeSnapshotError("foreign_native_snapshot", "The opened audio session belongs to another project.")

    def native_snapshot(self, project_id, track_id=None):
        # A just-opened or switched engine can explicitly report unavailable
        # native rows. One fresh read-only session may recover after bootstrap;
        # invalid, truncated or foreign observations never receive this retry.
        with self.lock:
            for attempt in range(2):
                try:
                    return self._native_snapshot_once(project_id, track_id)
                except NativeSnapshotError as error:
                    if error.code != "native_state_unavailable" or attempt:
                        raise
                    # Keep the requested read/edit context; only the bootstrap
                    # targets a validated persisted source clip in this project.
                    self._warm_project(project_id, track_id)

    def create_browser_ticket(self, project_id, origin, track_id=None):
        """Issue a read-only, origin-bound single-use ticket, never OAuth."""
        project_id = _opaque(project_id, "project id")
        if track_id is not None:
            track_id = _opaque(track_id, "track id")
        parsed = urlsplit(origin) if isinstance(origin, str) else None
        if (parsed is None or parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost")
                or parsed.username or parsed.password or parsed.path not in ("", "/") or parsed.query or parsed.fragment):
            raise NativeSnapshotError("invalid_realtime_origin", "Use this local editor's own origin for its realtime ticket.", 400)
        # The HTTP handler must additionally compare this origin to its checked
        # Host/Origin; callers cannot supply an arbitrary browser origin.
        with self.lock:
            while len(self.browser_sessions) >= 128:
                old = next((key for key, value in self.browser_sessions.items() if value.get("closed")), None)
                if old is None:
                    raise NativeSnapshotError("too_many_realtime_sessions", "Close an existing editor realtime session first.", 429)
                self.browser_sessions.pop(old)
        body = {"mode": "read", "origin": origin.rstrip("/")}
        if track_id:
            body["track_id"] = track_id
        opened = _data(self.call("openInteractiveSession", path={"project_id": project_id}, body=body))
        session_id = _opaque(opened.get("session_id"), "browser session id")
        with self.lock:
            self.browser_sessions[session_id] = {"project_id": project_id, "close_key": str(uuid.uuid4())}
        try:
            url = _websocket_url(opened.get("websocket_url"), self.origin)
            ticket = opened.get("session_ticket")
            if opened.get("mode", "read") != "read" or not isinstance(ticket, str) or not ticket or len(ticket) > 16384:
                raise NativeSnapshotError("invalid_realtime_session", "Studio API returned no read-only browser ticket.")
            safe = {key: copy.deepcopy(opened[key]) for key in
                ("session_id", "session_ticket", "ticket_expires_at", "expires_at", "revision", "sample_rate", "mode") if key in opened}
            safe.update({"project_id": project_id, "websocket_url": url, "mode": "read"})
            return safe
        except Exception:
            self.close_browser_ticket(session_id)
            raise

    def close_browser_ticket(self, session_id):
        session_id = _opaque(session_id, "browser session id")
        with self.lock:
            owned = self.browser_sessions.get(session_id)
            if owned is None:
                raise NativeSnapshotError("foreign_realtime_session", "This editor did not open that browser session.", 403)
            if owned.get("closed"):
                return {**copy.deepcopy(owned["result"]), "already_closed": True}
            result = _data(self.call("closeInteractiveSession", path={"session_id": session_id}, idempotency_key=owned["close_key"]))
            safe = {key: copy.deepcopy(result[key]) for key in ("session_id", "status", "already_closed") if key in result}
            owned.update({"closed": True, "result": copy.deepcopy(safe)})
            return safe
