'use strict';
/* Checklists v1 — backup, restore, retention and migration of run history.
   Backups carry only recent history so they stay well under the 5 MB restore limit. */
const CL_BACKUP_DAYS = 90;
const CL_PRUNE_DAYS = 180;

/* Runs/entries embedded in a db.checklists block (e.g. a newer backup restored by an older app). */
function clEmbeddedHistory(raw) {
  const src = clIsPlain(raw) ? raw : {};
  const runs = (Array.isArray(src.runs) ? src.runs : []).slice(0, CL_LIMITS.runs).map(clCleanRun).filter(Boolean);
  const runIds = new Set(runs.map(r => r.id));
  const entries = (Array.isArray(src.entries) ? src.entries : []).slice(0, CL_LIMITS.entries)
    .map(clCleanEntry).filter(e => e && runIds.has(e.runId));
  return { runs, entries };
}

/* Cleaned state plus any history still waiting to reach IndexedDB, so a later save keeps it. */
function clStateWithStash(raw) {
  const state = clCleanState(raw), stash = clEmbeddedHistory(raw);
  if (stash.runs.length) Object.assign(state, stash);
  return state;
}

function clAllEntries() {
  return [...CL.entries.values()].flat();
}

function clBackup(source) {
  const from = clShiftDate(clToday(), -CL_BACKUP_DAYS);
  const runs = CL.runs.filter(r => r.businessDate >= from), runIds = new Set(runs.map(r => r.id));
  const entries = clAllEntries().filter(e => runIds.has(e.runId));
  CL.backupNote = ` Includes ${clPlural(runs.length, 'checklist run')} from the last ${CL_BACKUP_DAYS} days.`;
  return { ...source, checklists: { ...clCleanState(source.checklists), runs, entries } };
}

const clBackupNote = () => CL.backupNote || '';

/* Stages the checklist part of a restore into `target` (not yet the live db). Throws when run history
   cannot be written, so the caller keeps the current db and IndexedDB stays as it was. */
async function clRestore(block, target, previous) {
  if (!clIsPlain(block)) {
    target.checklists = clStateWithStash(previous);
    return;
  }
  const next = clCleanState(block);
  next.deviceId = clId(previous && previous.deviceId) || next.deviceId || clNewId();
  if (Array.isArray(block.runs)) {
    const history = clEmbeddedHistory(block);
    await clReplaceAll(history.runs, history.entries);
  }
  target.checklists = next;
  CL.editDraft = null;
}

/* Deletes runs (and their entries) older than CL_PRUNE_DAYS business days. Failure only logs. */
async function clPruneOld() {
  const cutoff = clShiftDate(clToday(), -CL_PRUNE_DAYS);
  const old = CL.runs.filter(r => r.businessDate < cutoff);
  if (!old.length) return;
  const oldIds = new Set(old.map(r => r.id)), oldEntries = clAllEntries().filter(e => oldIds.has(e.runId));
  try {
    await clTx(['runs', 'entries'], 'readwrite', tx => {
      old.forEach(r => tx.objectStore('runs').delete(r.id));
      oldEntries.forEach(e => tx.objectStore('entries').delete(e.id));
    });
  } catch (error) {
    console.warn('Could not remove old checklist history', error);
    return;
  }
  clSetMemory(CL.runs.filter(r => !oldIds.has(r.id)), clAllEntries().filter(e => !oldIds.has(e.runId)));
  notify(`Removed ${clPlural(old.length, 'checklist run')} older than ${CL_PRUNE_DAYS} days; ${CL.runs.length} kept.`);
}

/* Moves embedded history into IndexedDB. On failure it stays in db.checklists for the next start. */
async function clMigrateEmbedded(embedded) {
  if (!embedded.runs.length) return;
  const knownRuns = new Set(CL.runs.map(r => r.id)), knownEntries = new Set(clAllEntries().map(e => e.id));
  const runs = embedded.runs.filter(r => !knownRuns.has(r.id));
  const entries = embedded.entries.filter(e => !knownEntries.has(e.id));
  let stored = false;
  try {
    if (CL.memoryOnly || !CL.idb) throw new Error('IndexedDB is not available');
    await clTx(['runs', 'entries'], 'readwrite', tx => {
      runs.forEach(r => tx.objectStore('runs').put(clone(r)));
      entries.forEach(e => tx.objectStore('entries').put(e));
    });
    stored = true;
  } catch (error) {
    clStorageFailed(error);
    Object.assign(db.checklists, embedded);
  }
  clSetMemory([...CL.runs, ...runs], [...clAllEntries(), ...entries]);
  if (stored && clCanSave()) save();
}
