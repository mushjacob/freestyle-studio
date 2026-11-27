import {hostFetch,freestyleOrigin} from './freestyle-host-transport.js';
/** Local debug log: browser-reported diagnostics sent to the loopback server's
 * `/api/diagnostics/client` ring so agents can see what the real browser did.
 * Never send credentials, tokens or user content beyond ids/field names/counts.
 *
 * Round 10: the log went silent mid-session. Every POST used `keepalive: true`,
 * whose in-flight body budget is 64 KB per document in Chromium; a send over
 * that budget is rejected, and the old `.catch(() => {})` discarded the whole
 * batch with no trace (a queue over 200 was also trimmed silently). Now:
 * - ordinary flushes use a plain fetch; keepalive is reserved for page hide
 *   and only within the budget,
 * - each POST body is size-bounded,
 * - a failed batch is put back and retried with backoff (bounded),
 * - every entry carries a sequence number and any loss is reported as a
 *   `client-log-dropped` entry, so a gap is visible instead of silent,
 * - the flush timer is always re-armed while entries are waiting. */
const MAX_QUEUE = 400, MAX_BATCH = 50, MAX_BODY = 48 * 1024, KEEPALIVE_BUDGET = 60 * 1024, MAX_ENTRY = 4000;

export function createClientLogger({
  fetch: fetchImpl = (...args) => hostFetch(...args),
  enabled = () => { if (typeof window === 'undefined' || typeof globalThis.fetch !== 'function') return false; try { return /^(127\.0\.0\.1|localhost)$/.test(new URL(freestyleOrigin()).hostname); } catch { return false; } },
  setTimer = (fn, ms) => setTimeout(fn, ms),
  now = () => Date.now(),
  url = '/api/diagnostics/client',
  // One id per page load: `seq` restarts at 1 after a reload, so entries carry
  // their page and the server marks each page's first entry.
  pageId = (() => { try { return globalThis.crypto?.randomUUID?.().slice(0, 13) || `p${Date.now().toString(36)}`; } catch { return `p${Date.now().toString(36)}`; } })(),
} = {}) {
  const queue = [];
  let timer = null, sending = false, seq = 0, dropped = 0, failures = 0, keepaliveInFlight = 0;
  const stats = {sent: 0, failedPosts: 0, dropped: 0, requeued: 0};

  function schedule(ms) {
    if (timer !== null) return;
    try { timer = setTimer(() => { timer = null; flush(); }, ms); } catch { timer = null; }
  }
  function noteDrop(count) { if (count > 0) { dropped += count; stats.dropped += count; } }
  function trim() { if (queue.length > MAX_QUEUE) noteDrop(queue.splice(0, queue.length - MAX_QUEUE).length); }

  function take() {
    // A loss report always travels first so the gap sits next to its cause.
    const reported = dropped, batch = reported ? [{kind: 'client-log-dropped', atMs: now(), seq: ++seq, page: pageId, data: {dropped: reported, reason: 'queue_overflow_or_send_failure'}}] : [];
    dropped = 0;let size = 16 + (reported ? JSON.stringify(batch[0]).length : 0);
    while (queue.length && batch.length < MAX_BATCH) {
      const next = JSON.stringify(queue[0]).length + 1;
      if (batch.length && size + next > MAX_BODY) break;
      batch.push(queue.shift());size += next;
    }
    return {batch, reported, body: JSON.stringify({entries: batch})};
  }

  async function post(body, {keepalive = false} = {}) {
    const response = await fetchImpl(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body, ...(keepalive ? {keepalive: true} : {})});
    if (!response?.ok) throw new Error(`diagnostics POST ${response?.status}`);
  }

  async function flush() {
    if (sending) return;
    if (!queue.length && !dropped) return;
    let on = false;try { on = enabled(); } catch {}
    if (!on) { queue.length = 0; dropped = 0; return; }
    sending = true;
    const {batch, reported, body} = take();
    try {
      await post(body);
      stats.sent += batch.length;failures = 0;
    } catch {
      stats.failedPosts++;failures++;
      // Put the batch back (oldest first) for a bounded retry instead of losing it.
      const entries = reported ? batch.slice(1) : batch;
      queue.unshift(...entries);stats.requeued += entries.length;dropped += reported;trim();
    } finally {
      sending = false;
      if (queue.length || dropped) schedule(failures ? Math.min(5000, 250 * 2 ** Math.min(failures, 5)) : 50);
    }
  }

  /** Page hide: hand what fits to the browser within the keepalive budget. */
  function flushOnHide() {
    try {
      if (!enabled() || (!queue.length && !dropped)) return;
      const {batch, reported, body} = take();
      if (!batch.length) return;
      if (keepaliveInFlight + body.length > KEEPALIVE_BUDGET) { queue.unshift(...(reported ? batch.slice(1) : batch));dropped += reported;return; }
      keepaliveInFlight += body.length;
      post(body, {keepalive: true}).then(() => { stats.sent += batch.length; }, () => { stats.failedPosts++;dropped += reported;noteDrop(batch.length - (reported ? 1 : 0)); }).finally(() => { keepaliveInFlight -= body.length; });
    } catch {}
  }

  function log(kind, data = {}) {
    try {
      let safe;try { safe = JSON.parse(JSON.stringify(data ?? {})); } catch { safe = {unserializable: true}; }
      const text = JSON.stringify(safe ?? {});
      queue.push({kind: String(kind).slice(0, 80), atMs: now(), seq: ++seq, page: pageId, data: text.length > MAX_ENTRY ? {truncated: text.slice(0, MAX_ENTRY)} : safe});
      trim();
    } catch {}
    schedule(250);
  }

  return {log, flush, flushOnHide, pageId, get pending() { return queue.length; }, get stats() { return {...stats, queued: queue.length, pendingDropped: dropped}; }};
}

const logger = createClientLogger();

/** Record one diagnostic entry. `data` must be small and JSON-safe. */
export function clientLog(kind, data = {}) { logger.log(kind, data); }
export const clientLogStats = () => logger.stats;

if (typeof window !== 'undefined') {
  window.__vegetableClientLog = clientLog;
  window.__vegetableClientLogStats = clientLogStats;
  try { window.addEventListener?.('pagehide', () => logger.flushOnHide()); } catch {}
  try { globalThis.document?.addEventListener?.('visibilitychange', () => { if (globalThis.document.visibilityState === 'hidden') logger.flushOnHide(); }); } catch {}
}
