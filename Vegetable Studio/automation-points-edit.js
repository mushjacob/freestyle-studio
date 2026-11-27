/**
 * One history-aware write of an automation envelope's points (inline Playlist
 * editing and live recording). It saves through AutomationStore.save, the same
 * revision-guarded path the automation editor dialog uses, and journals the
 * write as ONE Undo step. Undo/Redo restore the exact before/after points and
 * refuse (nothing sent) when the saved envelope no longer matches.
 */
import {clientLog} from './client-diagnostics.js';
import {pointsCheck} from './automation-host-clip.js';

const refused = message => Object.assign(new Error(message), {dispatched: false});
const notSent = error => Object.assign(error, {dispatched: false});
const settled = error => error?.status >= 400 && error?.status < 500 && !error?.uncertain ? notSent(error) : Object.assign(error, {operationUncertain: true});

/** store: AutomationStore; history: CloudPatternHistory or a getter for it. */
export function automationPointsEditor({store, history, log = clientLog}) {
  return {
    /**
     * envelope: a persisted store envelope; points: the complete new point list
     * (already normalized). Returns {envelope, recorded}. Rejects with the save
     * error when the write fails; no history step is recorded then.
     */
    async setPoints({envelope, points, label = 'Edit automation points', kind = 'automation_edit'}) {
      if (!envelope?.persisted || !envelope.id) throw new Error('This clip has only Freestyle’s default curve; create the automation clip first.');
      const clipId = String(envelope.clipId), targetKey = envelope.targetKey, journal = typeof history === 'function' ? history() : history;
      const live = store.find(clipId, targetKey) || envelope;
      const before = structuredClone(live.points || []), after = structuredClone(points), beforeCheck = pointsCheck(before), afterCheck = pointsCheck(after);
      if (beforeCheck.pointsHash === afterCheck.pointsHash) return {envelope: live, recorded: false, unchanged: true};
      let pending = null;
      if (journal?.beginExternalStep) try { pending = journal.beginExternalStep({kind, label}); } catch (error) { log('automation-points', {step: 'begin-refused', message: error.message}); }
      let saved;
      try { saved = await store.save(live, structuredClone(after)); if (!saved?.persisted) throw new Error('Freestyle did not confirm the automation edit.'); }
      catch (error) { if (pending) journal.failExternalStep(pending, error); throw error; }
      const scope = journal?.context?.();
      const current = async () => { try { await store.reloadClip(clipId); } catch (error) { throw notSent(error); } return store.find(clipId, targetKey); };
      const write = async (expect, next, text) => {
        const live2 = await current();
        if (!live2?.persisted || !live2.id) throw refused(`The automation clip was removed. ${text} will not recreate it.`);
        if (pointsCheck(live2.points || []).pointsHash !== expect.pointsHash) throw refused(`The automation clip was edited after this step. ${text} will not overwrite the newer edit.`);
        let made; try { made = await store.save(live2, structuredClone(next)); } catch (error) { throw settled(error); }
        if (!made?.persisted) throw Object.assign(new Error('Freestyle did not confirm the automation edit.'), {operationUncertain: true});
        return made;
      };
      const undo = async () => { const made = await write(afterCheck, before, 'Undo'); log('automation-points', {phase: 'undo', clipId, targetKey, envelopeId: made.id}); return {envelopeId: made.id, clipId, targetKey}; };
      const redo = async () => { const made = await write(beforeCheck, after, 'Redo'); log('automation-points', {phase: 'redo', clipId, targetKey, envelopeId: made.id}); return {envelopeId: made.id, clipId, targetKey}; };
      const detail = {clipId, targetKey, envelopeId: saved.id, from: beforeCheck, to: afterCheck};
      const recorded = pending ? journal.finishExternalStep(pending, {detail, undo, redo}) : journal?.recordExternalStep ? journal.recordExternalStep({kind, label, scope, detail, undo, redo}) : false;
      log('automation-points', {phase: 'saved', label, clipId, targetKey, recorded: recorded !== false, ...afterCheck});
      return {envelope: saved, recorded: recorded !== false};
    },
  };
}
