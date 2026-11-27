// Standalone Freestyle host — the SAME contract the app code uses inside
// Freestyle (window.__freestyleStudioHost, see docs/HOST_CONTRACT.md at the
// repo root), implemented for a UI running on its own (python3 server.py) with the
// public Studio API v1 + MCP:
//   * apiFetch      -> /fs/api/* on the local bridge, which adds the OAuth bearer
//                      (the browser never sees it) over warm keep-alive TLS.
//   * monitoring    -> POST /api/v1/projects/{id}/monitor + /monitor/offer: the
//                      engine runs this peer AS the user (peerGrant "write" with
//                      daw:write), so transport / mixer / plug-in input travel on
//                      the mozart-control / mozart-editor data channels exactly
//                      like the Freestyle Studio, and engine_clock is pushed.
//   * push          -> interactive-session WebSocket (ticket bound to this origin).
// Inside Freestyle (a parent host exists) this module does nothing.
const VIEW_ID = 'disabelton';
const APP_NAME = 'Disabelton';

const parentHost = (() => { try { return globalThis.parent !== globalThis ? globalThis.parent.__freestyleStudioHost || null : null; } catch { return null; } })();

// Browser pages only (Node test runs import app modules without a DOM).
if (!parentHost && !globalThis.__freestyleStudioHost && typeof document !== 'undefined' && typeof location !== 'undefined' && location.protocol.startsWith('http') && !location.pathname.includes('/studio-views/')) install();

function install() {
  const listeners = new Map();
  const emit = (event, payload) => { for (const fn of [...(listeners.get(event) || [])]) { try { fn(payload); } catch (error) { console.warn(`[standalone-host] ${event} listener failed`, error); } } };
  const uuid = () => globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const deviceId = (() => { const key = `${VIEW_ID}:device-id`; try { let id = localStorage.getItem(key); if (!id) { id = `${VIEW_ID}:${uuid()}`; localStorage.setItem(key, id); } return id; } catch { return `${VIEW_ID}:${uuid()}`; } })();
  const state = { status: null, project: null, user: null, monitor: new Map() };
  let previewGeneration = 0, stoppedThrough = 0, previewInFlight = null, unscopedPreview = false;
  const peerClient = new Map(); // projectId -> client_id of this page's monitoring peer (pattern arms are per peer)
  const monitorClients = new Map(); // projectId -> client ids offered by this page (closed on exit)

  const normalize = (path) => {
    let rel = String(path || '');
    try { const url = new URL(rel); rel = url.pathname + url.search; } catch { /* relative */ }
    if (rel.startsWith('/v1/')) rel = '/api' + rel;
    if (!rel.startsWith('/api/')) rel = '/api/v1' + (rel.startsWith('/') ? rel : '/' + rel);
    return rel;
  };
  const apiFetch = (path, init = {}) => {
    const headers = new Headers(init.headers || {});
    headers.set('X-Mozart-Device', deviceId);
    const method = String(init.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD' && normalize(path).startsWith('/api/v1/') && !headers.has('Idempotency-Key')) headers.set('Idempotency-Key', uuid());
    return fetch('/fs' + normalize(path), { ...init, headers, credentials: 'same-origin' });
  };
  const apiJson = async (method, path, body) => {
    const response = await apiFetch(path, { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}) });
    const text = await response.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch { /* not json */ }
    if (!response.ok) throw Object.assign(new Error(data?.error?.message || data?.message || `Freestyle answered ${response.status}`), { status: response.status, code: data?.error?.code || data?.code, data });
    return data;
  };
  const jsonResponse = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

  // ---- monitoring session (public API) ------------------------------------
  async function openMonitor(projectId, { force = false } = {}) {
    const pid = String(projectId || state.project?.id || '');
    if (!pid) throw new Error('Open a Freestyle project first.');
    const cached = state.monitor.get(pid);
    if (!force && cached && cached.expiresAt > Date.now() + 30_000) return cached;
    if (!force && cached?.pending) return cached.pending;
    const pending = apiJson('POST', `/api/v1/projects/${encodeURIComponent(pid)}/monitor`, {}).then((data) => {
      const session = data?.session || {};
      const turn = data?.turnCredentials || data?.turn_credentials || null;
      const exp = Number(turn?.expiresAt || turn?.expires_at || 0) * 1000 || Date.now() + 9 * 60_000;
      const entry = { session, turn, dawBaseUrl: String(session.dawBaseUrl || session.daw_base_url || data?.dawBaseUrl || ''), expiresAt: exp };
      state.monitor.set(pid, entry);
      return entry;
    }).catch((error) => { state.monitor.delete(pid); throw error; });
    state.monitor.set(pid, { ...(cached || {}), pending, expiresAt: 0 });
    return pending;
  }
  async function turnCredentials({ forceRefresh = false } = {}) {
    const pid = state.project?.id;
    const entry = await openMonitor(pid);
    if (!forceRefresh && entry.turn && entry.expiresAt > Date.now() + 30_000) return entry.turn;
    if (entry.dawBaseUrl) {
      const turn = await apiJson('GET', `/api/v1/realtime/turn-credentials?mozart_origin=${encodeURIComponent(entry.dawBaseUrl)}`);
      const fresh = turn?.turnCredentials || turn;
      entry.turn = fresh; entry.expiresAt = Number(fresh?.expiresAt || fresh?.expires_at || 0) * 1000 || Date.now() + 9 * 60_000;
      return fresh;
    }
    return (await openMonitor(pid, { force: true })).turn;
  }

  // The app's engine calls, mapped onto the public API (no direct engine HTTP
  // for third-party apps). Unsupported routes answer 501 so callers fall back.
  async function dawFetch(route, init = {}, opts = {}) {
    const pid = String(opts.projectId || state.project?.id || '');
    let body = {}; try { body = init.body ? JSON.parse(init.body) : {}; } catch { body = {}; }
    const base = `/api/v1/projects/${encodeURIComponent(pid)}`;
    const forward = async (path, payload) => {
      const response = await apiFetch(path, { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' }, signal: init.signal });
      const text = await response.text(); let data = null; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
      return { response, data };
    };
    if (route === '/rick/webrtc/offer') {
      await openMonitor(pid).catch(() => null);
      const sdp = body?.offer?.sdp || body?.sdp;
      const payload = { sdp, client_id: String(body.clientId || body.client_id || `${VIEW_ID}-${uuid()}`), ...(body.turn_credentials ? { turn_credentials: body.turn_credentials } : {}), ...(body.qualityProfile || body.quality_profile ? { quality_profile: body.qualityProfile || body.quality_profile } : {}), ...(typeof body.lowLatency === 'boolean' ? { low_latency: body.lowLatency } : {}), ...(body.trickle === true ? { trickle: true } : {}) };
      peerClient.set(pid, payload.client_id); // the monitoring peer that owns this page's pattern arms
      if (!monitorClients.has(pid)) monitorClients.set(pid, new Set());
      monitorClients.get(pid).add(payload.client_id);
      let { response, data } = await forward(`${base}/monitor/offer`, payload);
      if (response.status === 404 && /session_not_found|not_loaded/i.test(JSON.stringify(data || {}))) {
        await openMonitor(pid, { force: true });
        ({ response, data } = await forward(`${base}/monitor/offer`, payload));
      }
      if (!response.ok) return jsonResponse(response.status, data);
      const answer = data?.answer || {};
      return jsonResponse(200, { ...data, ...answer, answer });
    }
    // Pattern previews (Freestyle #11 / #14): arms, starts and stops are kept per monitoring peer (client_id), and a
    // start / stop carries the caller's increasing preview_request_id, so the engine itself refuses a late start
    // after a Stop (409 stale_preview_request).
    const flat = (response, data, extra = {}) => {
      const requestId = response.headers.get('x-request-id') || data?.error?.requestId || null;
      if (response.ok) { const result = data?.response ?? data?.result ?? data; return jsonResponse(response.status, { ...result, ok: result?.ok !== false, ...extra(data, result), ...(requestId ? { requestId } : {}) }); }
      // Errors keep the public body and lift its code / details (e.g. not_armed missing_signatures) to the top level.
      const error = data?.error && typeof data.error === 'object' ? data.error : {};
      const details = error.details && typeof error.details === 'object' ? error.details : {};
      const code = error.code || data?.code || null;
      return jsonResponse(response.status, { ...details, ...(data && typeof data === 'object' ? data : {}), ok: false, ...(code ? { code } : {}), ...(error.message && !data?.message ? { message: String(error.message) } : {}), ...(requestId ? { requestId } : {}), ...(response.headers.get('retry-after') ? { retryAfterSec: Number(response.headers.get('retry-after')) } : {}) });
    };
    const none = () => ({});
    const requestIdOf = (value) => (Number.isSafeInteger(value) && value >= 1 ? { preview_request_id: value } : {});
    if (route === '/patterns/preview') {
      const clientId = String(body.client_id || peerClient.get(pid) || '');
      const keys = ['pattern', 'length_ticks', 'ppq', 'bars', 'bpm', 'placement_id', 'repeat_count', 'gain', 'phase_offset_sec', 'lead_sec', 'swing', 'track_id', 'armed_signature'];
      const payload = { ...Object.fromEntries(keys.filter((k) => body[k] !== undefined && body[k] !== null).map((k) => [k, body[k]])), ...requestIdOf(body.preview_request_id), ...(clientId ? { client_id: clientId } : {}) };
      if (body.arm_only) {
        if (!clientId) return jsonResponse(409, { ok: false, code: 'monitor_peer_required', error: 'Open the audio monitor before arming a pattern.' });
        const { response, data } = await forward(`${base}/patterns:preview`, { ...payload, arm_only: true });
        return flat(response, data, (envelope, result) => ({ armed: result?.armed === true, armed_signature: result?.armed_signature ?? envelope?.armedSignature ?? payload.armed_signature, client_id: clientId }));
      }
      // A start without a request id (older callers) keeps the local guard: a Stop issued while it compiles is
      // re-sent the moment it lands.
      const guarded = payload.preview_request_id === undefined, generation = ++previewGeneration;
      if (!clientId) unscopedPreview = true;
      const started = forward(`${base}/patterns:preview`, payload);
      previewInFlight = started.catch(() => null);
      const { response, data } = await started;
      if (previewInFlight && generation === previewGeneration) previewInFlight = null;
      if (guarded && stoppedThrough >= generation) {
        forward(`${base}/pattern-previews:stopAll`, clientId ? { client_id: clientId } : {}).catch(() => null);
        return jsonResponse(409, { code: 'stale_preview_request', stopped: true, error: 'Stopped while the preview was starting.' });
      }
      return flat(response, data, none);
    }
    if (route === '/patterns/preview/launch') {
      const clientId = String(body.client_id || peerClient.get(pid) || '');
      if (!clientId) return jsonResponse(409, { ok: false, code: 'monitor_peer_required', error: 'Open the audio monitor before launching a scene.' });
      const keys = ['previews', 'quantize', 'beats_per_bar', 'lead_sec', 'stop_others', 'track_id'];
      const payload = { ...Object.fromEntries(keys.filter((k) => body[k] !== undefined && body[k] !== null).map((k) => [k, body[k]])), ...requestIdOf(body.preview_request_id), client_id: clientId };
      const { response, data } = await forward(`${base}/pattern-previews:launch`, payload);
      return flat(response, data, none);
    }
    if (route === '/patterns/preview/stop') {
      stoppedThrough = previewGeneration;
      const pending = previewInFlight, clientId = String(body.client_id || peerClient.get(pid) || '');
      const slot = typeof body.slot_id === 'string' && body.slot_id ? { slot_id: body.slot_id } : {};
      if (!clientId) {
        // No monitoring peer: the previews were started without client_id; stop them the same way.
        const { response, data } = await forward(`${base}/pattern-previews:stopAll`, {});
        if (pending) pending.then(() => forward(`${base}/pattern-previews:stopAll`, {}).catch(() => null));
        unscopedPreview = false;
        return flat(response, data, none);
      }
      const payload = { ...requestIdOf(body.preview_request_id), ...slot, client_id: clientId };
      const { response, data } = await forward(`${base}/pattern-previews:stop`, payload);
      // A preview started before the peer existed is not tied to it: stop it without client_id too.
      if (unscopedPreview && !slot.slot_id) { unscopedPreview = false; forward(`${base}/pattern-previews:stopAll`, {}).catch(() => null); }
      if (pending && payload.preview_request_id === undefined) pending.then(() => forward(`${base}/pattern-previews:stopAll`, { client_id: clientId }).catch(() => null));
      return flat(response, data, none);
    }
    return jsonResponse(501, { code: 'not_available_standalone', error: `${route} is Freestyle-internal.` });
  }

  // Freestyle Studio's desktop ICE policy: first relay candidate / complete, 4 s cap, 2.5 s zero-candidate exit.
  function waitForIceGathering(pc, { signal, budgetMs = 4000 } = {}) {
    if (!pc || pc.iceGatheringState === 'complete') return Promise.resolve('complete');
    return new Promise((resolve) => {
      let n = 0, done = false;
      const finish = (why) => { if (done) return; done = true; clearTimeout(cap); clearTimeout(dead); pc.removeEventListener('icecandidate', onCand); pc.removeEventListener('icegatheringstatechange', onState); signal?.removeEventListener?.('abort', onAbort); resolve(why); };
      const onCand = (e) => { const line = e?.candidate?.candidate || ''; if (!line) return; n++; if (line.includes(' relay ')) finish('relay'); };
      const onState = () => { if (pc.iceGatheringState === 'complete') finish('complete'); };
      const onAbort = () => finish('aborted');
      const cap = setTimeout(() => finish('budget'), budgetMs);
      const dead = setTimeout(() => { if (!n) finish('dead'); }, 2500);
      pc.addEventListener('icecandidate', onCand); pc.addEventListener('icegatheringstatechange', onState); signal?.addEventListener?.('abort', onAbort, { once: true });
    });
  }

  async function openProject(projectId) {
    const id = String(projectId || '');
    if (!id) return false;
    // Warm the engine session + TURN in parallel with the project read (first-click latency): the monitor offer can
    // then go out while the app is still loading the project.
    openMonitor(id).catch(() => null);
    const project = await apiJson('GET', `/api/v1/projects/${encodeURIComponent(id)}`).catch(() => null);
    if (!project) return false;
    state.project = { ...project, id: project.id || id };
    try { await fetch('/api/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: id, trackId: '' }) }); } catch { /* best effort */ }
    hideOverlay();
    emit('project', state.project);
    return true;
  }

  const host = Object.freeze({
    version: 1,
    mode: 'standalone',
    // patternArm / sceneLaunch: the public previewPattern arm_only + launchPatternPreviews (Freestyle #11, #14).
    capabilities: Object.freeze({ patternArm: true, sceneLaunch: true, directEngine: false, share: false, mozart: false }),
    get origin() { return location.origin; },
    apiBaseUrl: () => '/fs/api',
    deviceId: () => deviceId,
    getProjectId: () => String(state.project?.id || ''),
    getProject: () => state.project,
    getUser: () => state.user,
    getActiveView: () => VIEW_ID,
    getSessionToken: async () => '',
    apiFetch,
    getDawBaseUrl: async (projectId) => (await openMonitor(projectId || state.project?.id)).dawBaseUrl,
    dawFetch,
    getTurnCredentials: turnCredentials,
    ensureEngineSession: async () => { await openMonitor(state.project?.id, { force: true }); return { ok: true, projectId: state.project?.id }; },
    waitForIceGathering,
    requestView: () => false,
    openProject,
    showProjectPicker: () => showPicker(),
    on(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); return () => listeners.get(event)?.delete(fn); },
  });
  Object.defineProperty(globalThis, '__freestyleStudioHost', { value: host, configurable: true });

  // ---- sign-in + project picker (only what Freestyle itself would provide) --
  let overlay = null;
  function hideOverlay() { overlay?.remove(); overlay = null; }
  function showOverlay(build) {
    const mount = () => {
      hideOverlay();
      overlay = document.createElement('div');
      overlay.className = 'fs-standalone-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(10,12,14,.55);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);font:14px/1.4 "Helvetica Neue",Helvetica,Arial,sans-serif;color:#fff';
      const card = document.createElement('div');
      card.style.cssText = 'width:min(440px,calc(100vw - 32px));max-height:80vh;overflow:auto;padding:22px;border-radius:12px;background:rgba(14,14,16,.92);box-shadow:0 24px 64px rgba(0,0,0,.45)';
      build(card);
      overlay.append(card);
      document.body.append(overlay);
    };
    if (document.body) mount(); else addEventListener('DOMContentLoaded', mount, { once: true });
  }
  const button = (label, onClick, primary = false) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.style.cssText = `height:36px;padding:0 16px;border-radius:18px;border:1px solid rgba(255,255,255,.18);background:${primary ? '#fff' : 'transparent'};color:${primary ? '#000' : '#fff'};font:600 13px/1 inherit;cursor:pointer`; b.onclick = onClick; return b; };

  function showSignIn(message = '') {
    showOverlay((card) => {
      const title = document.createElement('div'); title.style.cssText = 'font-size:18px;font-weight:600;margin-bottom:6px'; title.textContent = APP_NAME;
      const text = document.createElement('div'); text.style.cssText = 'opacity:.7;margin-bottom:18px'; text.textContent = message || 'Connect your Freestyle Pro account. The sign-in happens on Freestyle; this app never sees your password or token.';
      card.append(title, text);
      card.append(button('Connect Freestyle', async () => {
        try {
          const r = await fetch('/api/auth/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
          const data = await r.json();
          if (data.authorizationUrl) window.open(data.authorizationUrl, 'freestyle-auth', 'width=520,height=720');
          waitForConnection();
        } catch (error) { showSignIn('Could not start sign-in: ' + error.message); }
      }, true));
    });
  }
  let connectionTimer = null, connectionDeadline = 0, booting = null;
  const onConnectedMessage = (e) => { if (e.origin === location.origin && e.data === 'freestyle-connected') checkConnection(); };
  addEventListener('message', onConnectedMessage);
  async function checkConnection() {
    if (Date.now() > connectionDeadline) { clearInterval(connectionTimer); connectionTimer = null; return; }
    const status = await fetch('/api/status').then((r) => r.json()).catch(() => null);
    if (status?.connected && connectionTimer !== null) { clearInterval(connectionTimer); connectionTimer = null; boot(); }
  }
  function waitForConnection() {
    clearInterval(connectionTimer);
    connectionDeadline = Date.now() + 5 * 60_000;
    connectionTimer = setInterval(checkConnection, 1500);
  }

  async function showPicker() {
    showOverlay((card) => { card.innerHTML = '<div style="opacity:.7">Loading your projects…</div>'; });
    let list = [];
    try { const data = await apiJson('GET', '/api/v1/projects?limit=100'); list = data?.data || data?.projects || []; } catch (error) {
      if (error.status === 401) return showSignIn('Your Freestyle connection expired. Connect again.');
      return showOverlay((card) => { card.textContent = 'Could not load projects: ' + String(error.message || error); });
    }
    showOverlay((card) => {
      const heading = document.createElement('div'); heading.style.cssText = 'font-size:18px;font-weight:600;margin-bottom:12px'; heading.textContent = 'Open a project';
      card.append(heading);
      const search = document.createElement('input');
      search.placeholder = 'Search projects';
      search.style.cssText = 'width:100%;box-sizing:border-box;height:36px;margin-bottom:10px;padding:0 12px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#fff;font:inherit';
      const rows = document.createElement('div');
      const render = () => {
        const q = search.value.trim().toLowerCase();
        rows.replaceChildren(...list.filter((p) => !q || String(p.title || '').toLowerCase().includes(q)).slice(0, 80).map((p) => {
          const row = document.createElement('button');
          row.type = 'button';
          row.textContent = p.title || p.id;
          row.style.cssText = 'display:block;width:100%;text-align:left;padding:10px 12px;margin:2px 0;border:0;border-radius:8px;background:transparent;color:#fff;font:inherit;cursor:pointer';
          row.onmouseenter = () => { row.style.background = 'rgba(255,255,255,.08)'; };
          row.onmouseleave = () => { row.style.background = 'transparent'; };
          row.onclick = () => openProject(p.id);
          return row;
        }));
      };
      search.oninput = render;
      card.append(search, rows);
      render();
      setTimeout(() => search.focus(), 0);
    });
    // With a project already open the picker can be dismissed (File > Open… / Close, then Esc or a click outside).
    if (state.project?.id && overlay) {
      const shown = overlay;
      const onKey = (e) => {
        if (overlay !== shown) { removeEventListener('keydown', onKey, true); return; }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); removeEventListener('keydown', onKey, true); hideOverlay(); }
      };
      addEventListener('keydown', onKey, true);
      shown.addEventListener('pointerdown', (e) => { if (e.target === shown) { removeEventListener('keydown', onKey, true); hideOverlay(); } });
    }
  }

  function boot() { booting ??= runBoot().finally(() => { booting = null; }); return booting; }
  async function runBoot() {
    const status = await fetch('/api/status').then((r) => r.json()).catch(() => null);
    state.status = status;
    if (!status?.connected) return showSignIn();
    const workspace = await fetch('/api/workspace').then((r) => r.json()).catch(() => ({}));
    const params = new URLSearchParams(location.search);
    const wanted = params.get('project') || workspace?.projectId || '';
    if (wanted && await openProject(wanted).catch(() => false)) return;
    showPicker();
  }
  addEventListener('pagehide', () => {
    for (const [pid, ids] of monitorClients) for (const id of ids) {
      try { fetch(`/fs/api/v1/projects/${encodeURIComponent(pid)}/monitor?client_id=${encodeURIComponent(id)}`, { method: 'DELETE', keepalive: true, headers: { 'X-Mozart-Device': deviceId } }); } catch { /* best effort */ }
    }
  });
  boot();
}

export {};
