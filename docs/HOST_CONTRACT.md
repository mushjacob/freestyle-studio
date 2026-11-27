# Studio host contract (`window.__freestyleStudioHost`)

The apps are written against one small host object. It is how a UI reaches
Freestyle without knowing whether it runs **inside Freestyle** (the Studio
**View** menu) or **standalone** on your machine.

- **Inside Freestyle:** Freestyle provides the host. Your code must not assume
  anything about how Freestyle implements it.
- **Standalone:** `freestyle-standalone-host.js` (one copy per app; the copies
  share their core but differ in `VIEW_ID` / `APP_NAME` and in the capability
  flags below) implements the same object on the **public
  Studio API v1**, through the local `server.py` bridge. It installs itself only
  when no host exists, so the same app code runs in both places.

App code finds the host as `window.parent.__freestyleStudioHost` (inside
Freestyle) or `globalThis.__freestyleStudioHost` (standalone). See
`freestyle-host-actions.js` / `freestyle-host-transport.js`.

## Members

| Member | Meaning |
|---|---|
| `version` | `1` |
| `mode` | `'standalone'` for the local build; anything else means "inside Freestyle" |
| `capabilities` | Feature flags. Standalone: `directEngine`, `share` and `mozart` are `false`. `patternArm` is `true` in Vegetable Studio, Illogic Amateur and Disabelton (public `previewPattern` `arm_only` + `pattern_preview_start`, since the 2026-11-18 release) and `false` in Modesty, which has no pattern rack. Disabelton also sets `sceneLaunch` (`launchPatternPreviews`) and Illogic Amateur `trickleIce`. Inside Freestyle Studio two more flags are `true`: `hostAudio` (Freestyle plays the engine audio itself, so keep your monitor element muted and use the peer for control, clock and stats only) and `continuousTransport` (switching to another view never stops playback: when you are hidden, pause your own loops but leave the transport rolling, finish only a take you are recording, and follow the engine clock when you are shown again). Both are absent (`false`) in the standalone host. Always check a flag before using the feature. |
| `origin` | Page origin |
| `apiBaseUrl()` | Base for API calls (`/fs/api` standalone) |
| `deviceId()` | Stable per-browser id, sent as `X-Mozart-Device` |
| `getProjectId()` / `getProject()` / `getUser()` | Current project id / summary / user |
| `getActiveView()` | This view's id (`vegetable-studio`, `modesty`) |
| `views()` | Inside Freestyle: `[[id, label], …]`, every Studio view in picker order (incl. `default`). List these in your own View menu. Absent in the standalone host (use the built-in fallback list). |
| `apiFetch(path, init)` | `fetch` to the Freestyle API. `path` is `/api/v1/...`, `/v1/...` or `/api/mcp`. Auth is added for you; your code never sees a token. v1 writes get an `Idempotency-Key`. |
| `dawFetch(route, init, opts)` | Engine routes used by the apps. Standalone maps the ones it supports onto public endpoints (below); anything else answers **501**. |
| `getDawBaseUrl(projectId)` | Engine origin for the project's monitor |
| `getTurnCredentials({forceRefresh})` | TURN credentials for the WebRTC peer |
| `ensureEngineSession()` | Make sure the project's engine session is open |
| `waitForIceGathering(pc)` | ICE gathering policy (first relay candidate, bounded wait) |
| `openProject(id)` | Switch project; emits `project` |
| `showProjectPicker()` | Standalone project picker |
| `requestView(id)` | Ask Freestyle to switch views (standalone: `false`) |
| `on(event, fn)` | Subscribe; returns an unsubscribe function. Events include `project`. |

## Standalone mapping onto the public API

| App call | Public Studio API v1 |
|---|---|
| `apiFetch('/api/v1/...')`, `/api/mcp` | Same path on Freestyle via `/fs/api/*` (the bridge adds your OAuth bearer) |
| Live audio peer: `dawFetch('/rick/webrtc/offer')` | `POST /api/v1/projects/{id}/monitor`, then `POST .../monitor/offer` (peer runs as you, `peerGrant: "write"`) |
| Transport / mixer / plug-in fast input | `mozart-control` / `mozart-editor` data channels on that peer |
| Playhead | `engine_clock` pushed on `mozart-control` (~100 ms) |
| Meters, plug-in GUI frames | `mozart-meters`, `mozart-editor-frames` |
| Pattern preview start / stop | `POST .../patterns:preview`, `POST .../pattern-previews:stopAll` |
| TURN refresh | `GET /api/v1/realtime/turn-credentials` |
| Server push (other people's edits) | Interactive-session WebSocket, ticket bound to the page origin |
| Close the peer on exit | `DELETE /api/v1/projects/{id}/monitor?client_id=...` |

Public references: [Studio API v1](https://freestyle.audio/docs/studio-api.html) ·
[Realtime: sessions & audio](https://freestyle.audio/docs/realtime.html) ·
[Build a DAW UI](https://freestyle.audio/docs/daw-guide.html) ·
[Authentication](https://freestyle.audio/docs/authentication.html) ·
OpenAPI: `https://freestyle.audio/api/v1/openapi.json`.

If a feature needs something this contract or the public API does not offer,
file an **Engine/API request** issue. Do not work around it
with private or undocumented endpoints.
