'use strict';
/* Checklists v1 — state and storage. Templates/settings live in db.checklists (localStorage via save()).
   Runs and append-only entries live in IndexedDB `barline-checklists`; memory mirrors it so a failing
   IndexedDB never loses the run in progress while the app stays open. */
const CL_DB_NAME = 'barline-checklists';
const CL_DB_VERSION = 1;
const CL = {
  ready: false, memoryOnly: false, warned: false, idb: null,
  runs: [], entries: new Map(), rev: 0, issueCache: null,
  unlocked: false, editDraft: null, collapsed: new Set(), stock: null
};

const clNewId = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : uid('cl'));
const clNow = () => new Date().toISOString();
const clState = () => db.checklists;
const clStaffNow = () => cleanName(db.preferences.preparerName) || clState().settings.lastStaff || 'Staff';
const clToday = () => clBusinessDate(new Date(), clState().settings.dayCutoff);

function clVibrate() {
  try {
    if (navigator.vibrate) navigator.vibrate(15);
  } catch (e) {
    /* Vibration is optional feedback; some browsers block it */
  }
}

function clStorageFailed(error) {
  CL.memoryOnly = true;
  if (CL.warned) return;
  CL.warned = true;
  console.warn('Checklist storage unavailable', error);
  notify('Checklist history cannot be saved on this device. Progress is kept only while the app stays open.');
}

function clIdbOpen() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const request = indexedDB.open(CL_DB_NAME, CL_DB_VERSION);
    request.onupgradeneeded = () => {
      const handle = request.result;
      if (!handle.objectStoreNames.contains('runs')) handle.createObjectStore('runs', { keyPath: 'id' });
      if (!handle.objectStoreNames.contains('entries')) handle.createObjectStore('entries', { keyPath: 'id' }).createIndex('runId', 'runId');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
    request.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
  });
}

/* Runs `work(tx, out)` in one transaction; resolves with out.value once the transaction commits. */
function clTx(stores, mode, work) {
  return new Promise((resolve, reject) => {
    if (!CL.idb) {
      reject(new Error('IndexedDB is not open'));
      return;
    }
    const out = {};
    let tx;
    try {
      tx = CL.idb.transaction(stores, mode);
      work(tx, out);
    } catch (error) {
      reject(error);
      return;
    }
    tx.oncomplete = () => resolve(out.value);
    tx.onerror = () => reject(tx.error || new Error('IndexedDB write failed'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

function clIdbWrite(stores, work) {
  if (CL.memoryOnly) return Promise.resolve();
  return clTx(stores, 'readwrite', work).catch(clStorageFailed);
}

function clChanged() {
  CL.rev++;
  CL.issueCache = null;
}

function clSetMemory(runs, entries) {
  const runIds = new Set(runs.map(r => r.id));
  CL.runs = runs;
  CL.entries = new Map(runs.map(r => [r.id, []]));
  for (const entry of entries) if (runIds.has(entry.runId)) CL.entries.get(entry.runId).push(entry);
  for (const list of CL.entries.values()) list.sort(clByAt);
  clChanged();
}

async function clLoadAll() {
  const raw = await clTx(['runs', 'entries'], 'readonly', (tx, out) => {
    const runsRequest = tx.objectStore('runs').getAll(), entriesRequest = tx.objectStore('entries').getAll();
    entriesRequest.onsuccess = () => {
      out.value = { runs: runsRequest.result || [], entries: entriesRequest.result || [] };
    };
  });
  clSetMemory(raw.runs.map(clCleanRun).filter(Boolean), raw.entries.map(clCleanEntry).filter(Boolean));
}

function clPutRun(run) {
  if (!CL.runs.includes(run)) {
    CL.runs.push(run);
    CL.entries.set(run.id, []);
  }
  clChanged();
  return clIdbWrite(['runs'], tx => tx.objectStore('runs').put(clone(run)));
}

/* Append-only: entries are never edited. `at` is kept strictly increasing per run so order is stable. */
function clAddEntry(run, taskId, fields) {
  const list = CL.entries.get(run.id) || [];
  let at = clNow();
  const last = list.length ? list[list.length - 1].at : '';
  if (at <= last) at = new Date(Date.parse(last) + 1).toISOString();
  const entry = clCleanEntry({ id: clNewId(), runId: run.id, taskId, byName: clStaffNow(), at, ...fields });
  list.push(entry);
  CL.entries.set(run.id, list);
  clChanged();
  clIdbWrite(['entries'], tx => tx.objectStore('entries').put(entry));
  return entry;
}

function clReplaceAll(runs, entries) {
  clSetMemory(runs, entries);
  return clIdbWrite(['runs', 'entries'], tx => {
    const runStore = tx.objectStore('runs'), entryStore = tx.objectStore('entries');
    runStore.clear();
    entryStore.clear();
    CL.runs.forEach(r => runStore.put(clone(r)));
    for (const list of CL.entries.values()) list.forEach(e => entryStore.put(e));
  });
}

const clRunById = id => CL.runs.find(r => r.id === id) || null;
const clRunEntries = run => CL.entries.get(run.id) || [];
const clRunProgress = run => clProgress(run, clRunEntries(run));

function clTemplates() {
  return [...CL_STARTERS, ...clState().templates.filter(t => !t.deletedAt)];
}

function clActiveTemplate(type) {
  const id = clState().settings.active[type];
  return clTemplates().find(t => t.id === id && t.type === type) || CL_STARTERS.find(t => t.type === type);
}

/* Open (unfinished) runs for today's business date, newest first. */
function clOpenRunsToday() {
  const today = clToday();
  return CL.runs.filter(r => !r.completedAt && r.businessDate === today).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

function clTodayRun(type) {
  const today = clToday();
  return CL.runs.filter(r => r.type === type && r.businessDate === today).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0] || null;
}

/* Every open issue across all runs, newest first; cached until the next change. */
function clOpenIssues() {
  if (CL.issueCache) return CL.issueCache;
  const out = [];
  for (const run of CL.runs) for (const issue of clRunProgress(run).openIssues) out.push({ run, ...issue });
  CL.issueCache = out.sort((a, b) => (a.entry.at < b.entry.at ? 1 : -1));
  return CL.issueCache;
}

function clStartRun(type, staffName) {
  const template = clActiveTemplate(type), now = clNow();
  const run = clCleanRun({
    id: clNewId(), templateId: template.id, templateVersion: template.version, type,
    snapshot: { name: template.name, sections: clone(template.sections), tasks: clone(template.tasks) },
    businessDate: clToday(), startedAt: now, completedAt: null, staffName,
    deviceId: clState().deviceId, ack: null, orderAdds: {}
  });
  clState().settings.lastStaff = staffName;
  save();
  clPutRun(run);
  return run;
}

/* Backup: the main db plus templates and the run history from memory (which mirrors IndexedDB). */
function clBackup(source) {
  const entries = [];
  for (const list of CL.entries.values()) entries.push(...list);
  return { ...source, checklists: { ...clCleanState(source.checklists), runs: CL.runs, entries } };
}

/* Restore: a backup without a `checklists` block keeps this device's templates and runs. */
async function clRestore(block, previous) {
  if (!clIsPlain(block)) {
    db.checklists = clCleanState(previous);
    return;
  }
  db.checklists = clCleanState(block);
  db.checklists.deviceId = clId(previous && previous.deviceId) || db.checklists.deviceId || clNewId();
  CL.unlocked = false;
  CL.editDraft = null;
  if (!Array.isArray(block.runs)) return;
  const runs = block.runs.slice(0, CL_LIMITS.runs).map(clCleanRun).filter(Boolean);
  const entries = (Array.isArray(block.entries) ? block.entries : []).slice(0, CL_LIMITS.entries).map(clCleanEntry).filter(Boolean);
  await clReplaceAll(runs, entries);
}

function clRerenderIfVisible() {
  const page = (location.hash.slice(1) || 'home').split('/')[0];
  if (page === 'home' || page.startsWith('checklists')) render();
}

async function clInit() {
  db.checklists = clCleanState(db.checklists);
  if (!db.checklists.deviceId) {
    db.checklists.deviceId = clNewId();
    save();
  }
  try {
    CL.idb = await clIdbOpen();
    await clLoadAll();
  } catch (error) {
    clStorageFailed(error);
  }
  CL.ready = true;
  clRerenderIfVisible();
}
