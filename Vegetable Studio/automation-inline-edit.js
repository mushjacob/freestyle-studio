/**
 * FL-style inline editing on a selected Playlist automation clip: click empty
 * space to add a point, drag a point to move it, right-click a point to delete
 * it, drag the small handle between two points to bend the segment, and
 * right-click a segment for curve types. DOM only; the point maths lives in
 * automation-curves.js and every commit goes through `onCommit` (one Undo step).
 */
import {addPointAt, movePoint, removePoint, segmentHasHandle, segmentIndexAt, segmentValueAt, setSegmentTension, tensionFromHandleValue} from './automation-curves.js';

const busyKeys = new Set();
const esc = value => String(value).replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[ch]);

/**
 * element: the `.automation-clip` node. envelope: the store envelope (points relative to the clip start).
 * normalize(points): the canonical point list; renderCurve(points): the clip's curve SVG html;
 * onCommit(points,label): async, one history step; onMenu(event,{points,segmentIndex}); snap(timeSec,event): snapped time;
 * notice(text): short user message.
 */
export function attachInlineAutomationEditor({element, envelope, durationSec, normalize = p => p, renderCurve = null, onCommit, onMenu = null, snap = (t) => t, notice = () => {}}) {
  if (!element || !envelope?.persisted || !(durationSec > 0)) return null;
  element.querySelector(':scope > .automation-inline-edit')?.remove();
  const key = `${envelope.clipId}|${envelope.targetKey}`;
  const overlay = document.createElement('div');
  overlay.className = 'automation-inline-edit';
  element.append(overlay);
  let points = normalize((envelope.points || []).map(item => ({...item})));
  const x = t => t / durationSec * 100, y = v => (1 - v) * 100;
  function paint(list) {
    let html = '';
    list.forEach((point, index) => {
      if (segmentHasHandle(list, index)) {
        const a = list[index], b = list[index + 1];
        html += `<span class="automation-inline-tension" data-handle="${index}" style="left:${x(a.timeSec + (b.timeSec - a.timeSec) / 2)}%;top:${y(segmentValueAt(a, b, 0.5))}%" title="Drag to curve this segment"></span>`;
      }
    });
    list.forEach((point, index) => { html += `<span class="automation-inline-node" data-node="${index}" style="left:${x(point.timeSec)}%;top:${y(point.value)}%" title="${esc(point.timeSec.toFixed(3))} s · ${esc((point.value * 100).toFixed(1))}%"></span>`; });
    overlay.innerHTML = html;
    if (renderCurve) { const svg = element.querySelector(':scope > .automation-clip-curve'); if (svg) svg.outerHTML = renderCurve(list); }
  }
  paint(points);
  const pointer = event => {
    const rect = overlay.getBoundingClientRect();
    return {time: Math.max(0, Math.min(durationSec, (event.clientX - rect.left) / Math.max(1, rect.width) * durationSec)), value: Math.max(0, Math.min(1, 1 - (event.clientY - rect.top) / Math.max(1, rect.height)))};
  };
  const commit = async (list, label) => {
    busyKeys.add(key);
    try { await onCommit(normalize(list), label); } catch (error) { notice(error?.message || String(error)); } finally { busyKeys.delete(key); }
  };
  overlay.onmousedown = overlay.ondblclick = overlay.onclick = event => { event.stopPropagation(); };
  overlay.onpointerdown = event => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    if (busyKeys.has(key)) return notice('Wait for the previous automation edit to finish saving.');
    const nodeEl = event.target.closest?.('[data-node]'), handleEl = event.target.closest?.('[data-handle]');
    let working = points, drag = null, label = '', moved = false;
    const startX = event.clientX, startY = event.clientY;
    if (nodeEl) { drag = {kind: 'node', index: Number(nodeEl.dataset.node)}; label = 'Move automation point'; }
    else if (handleEl) { drag = {kind: 'handle', index: Number(handleEl.dataset.handle)}; label = 'Curve automation segment'; }
    else {
      const at = pointer(event), time = snap(at.time, event);
      const next = addPointAt(points, time, at.value);
      if (next.length === points.length) return;
      working = next; label = 'Add automation point'; moved = true;
      drag = {kind: 'node', index: next.findIndex(item => Math.abs(item.timeSec - time) < 1e-6)};
      paint(working);
    }
    const move = e => {
      if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) < 3) return;
      moved = true;
      const at = pointer(e);
      if (drag.kind === 'node') working = movePoint(working, drag.index, snap(at.time, e), at.value);
      else { const a = points[drag.index], b = points[drag.index + 1]; working = setSegmentTension(points, drag.index, tensionFromHandleValue(a.value, b.value, at.value)); }
      paint(working);
    };
    const finish = e => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', finish);
      if (e.type === 'pointercancel' || !moved) { paint(points); return; }
      commit(working, label);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', finish);
  };
  overlay.oncontextmenu = event => {
    event.preventDefault(); event.stopPropagation();
    if (busyKeys.has(key)) return notice('Wait for the previous automation edit to finish saving.');
    const nodeEl = event.target.closest?.('[data-node]');
    if (nodeEl) {
      const next = removePoint(points, Number(nodeEl.dataset.node));
      if (next.length === points.length) return notice('Keep at least two points in the envelope.');
      commit(next, 'Delete automation point'); return;
    }
    const at = pointer(event), segmentIndex = segmentIndexAt(points, at.time);
    onMenu?.(event, {points, segmentIndex, timeSec: at.time, commit});
  };
  return {overlay, key, commit, get points() { return points; }};
}
