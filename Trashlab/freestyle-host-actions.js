// Freestyle app actions available from inside an embedded studio view: switch
// the Studio view, open Freestyle's Share and Mozart AI popups, and the
// collaboration controls. All delegate to window.parent.__freestyleStudioHost
// (the Freestyle host bridge); absent host = standalone build.
const FALLBACK_STUDIO_VIEWS = [
  ['default', 'Default'],
  ['vegetable-studio', 'Vegetable Studio'],
  ['disabelton', 'Disabelton'],
  ['illogic-amateur', 'Illogic Amateur'],
  ['illogic-amateur-classic', 'Illogic Amateur Classic'],
  ['street-band', 'Street Band'],
  ['trashlab', 'Trashlab'],
  ['modesty', 'Modesty'],
];
/** The Studio views the host offers, as [id, label] pairs (host.views(); this list when the host has none). */
export const STUDIO_VIEWS = (() => {
  try {
    const views = freestyleHost()?.views?.();
    if (Array.isArray(views) && views.length) return views.filter(v => Array.isArray(v) && v[0]).map(([id, label]) => [String(id), String(label || id)]);
  } catch {}
  return FALLBACK_STUDIO_VIEWS;
})();

export function freestyleHost() {
  try {
    const host = (globalThis.parent !== globalThis ? globalThis.parent?.__freestyleStudioHost : null) || globalThis.__freestyleStudioHost || null;
    return host && typeof host === 'object' ? host : null;
  } catch {
    return null;
  }
}

// Inside Freestyle (not the standalone host): Share, Mozart and Studio views exist.
export const embeddedInFreestyle = () => { const host = freestyleHost(); return !!host && host.mode !== 'standalone'; };
export const standaloneHost = () => freestyleHost()?.mode === 'standalone';
export const activeStudioView = () => freestyleHost()?.getActiveView?.() || '';
export function switchStudioView(id) { freestyleHost()?.requestView?.(id); }
export function openFreestyleShare() { return freestyleHost()?.openShare?.(); }
export function openFreestyleMozart() { return freestyleHost()?.openMozart?.(); }
export function toggleFreestyleChat() { return freestyleHost()?.toggleChat?.(); }
export function hostCan(name) { return typeof freestyleHost()?.[name] === 'function'; }
