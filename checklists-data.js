'use strict';
/* Checklists v1 — pure data: starter templates, validation, run/entry helpers.
   No DOM and no storage here, so every rule can be checked in isolation. */
const CL_TYPES = ['opening', 'closing', 'handover'];
const CL_TYPE_NAMES = { opening: 'Opening', closing: 'Closing', handover: 'Handover' };
const CL_STATES = ['done', 'issue', 'undone', 'resolved'];
const CL_HANDLED = ['done', 'issue', 'resolved'];
const CL_LINKS = { stock85: '86/85', order: 'Order', receive: 'Receive', recipes: 'Recipes' };
const CL_LIMITS = { name: 60, label: 120, note: 200, nextAction: 120, unit: 12, staff: 40, sections: 30, tasks: 150, templates: 30, runs: 5000, entries: 100000 };
const CL_DEFAULT_CUTOFF = '06:00';
const CL_HISTORY_DAYS = 30;
const CL_TZ = 'Asia/Amman';
const CL_STARTER_DATE = '2026-11-21T00:00:00.000Z';
const CL_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const CL_CUTOFF_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const CL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const CL_ISO_RE = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const CL_GUARD_KEEP_MS = 7 * 864e5;
const clStr = (v, n) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '';
/* A real calendar date: 2026-13-01 or 2026-02-30 fail the round trip. */
function clValidDate(v) {
  if (typeof v !== 'string' || !CL_DATE_RE.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number), date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
const clIso = v => {
  const match = typeof v === 'string' ? CL_ISO_RE.exec(v) : null;
  return match && clValidDate(match[1]) && Number.isFinite(Date.parse(v)) ? v : null;
};
const clNum = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
const clId = v => typeof v === 'string' && CL_ID_RE.test(v) ? v : null;
const clIsPlain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const clByAt = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);

/* Starter spec: [sectionName, [taskLabel | {label, kind, unit, min, max, link, required}]] */
function clBuildStarter(id, type, name, sections) {
  const template = { id, type, name, version: 1, updatedAt: CL_STARTER_DATE, deletedAt: null, sections: [], tasks: [] };
  sections.forEach(([sectionName, tasks], sectionIndex) => {
    const sectionId = id + '-s' + (sectionIndex + 1);
    template.sections.push({ id: sectionId, name: sectionName, order: sectionIndex });
    tasks.forEach((raw, taskIndex) => {
      const spec = typeof raw === 'string' ? { label: raw } : raw;
      template.tasks.push({
        id: sectionId + '-t' + (taskIndex + 1), sectionId, label: spec.label, kind: spec.kind || 'check',
        unit: spec.unit || '', min: spec.min ?? null, max: spec.max ?? null,
        required: spec.required !== false, order: taskIndex, link: spec.link || ''
      });
    });
  });
  return template;
}

const CL_STARTERS = [
  clBuildStarter('starter-opening', 'opening', 'Opening (starter)', [
    ['Bar', ['Check ice well', 'Cut garnishes', 'Fill juices and syrups', 'Stock straws and napkins']],
    ['Equipment', [{ label: 'Fridge temperature', kind: 'number', unit: '°C', min: 1, max: 5 }, 'Glass washer on', 'POS and printer on']],
    ['Stock', [{ label: 'Review 86/85 list', link: 'stock85' }]],
    ['Cleaning', ['Wipe bar top', 'Check bathrooms']]
  ]),
  clBuildStarter('starter-closing', 'closing', 'Closing (starter)', [
    ['Bar', ['Clean tools and stations', 'Label and store open prep', 'Empty ice well']],
    ['Cleaning', ['Floors', 'Mats', 'Bins out']],
    ['Equipment', ['Glass washer off and drained', { label: 'Record faults for the opener', required: false }]],
    ['Stock', [{ label: 'Count low items', link: 'stock85' }, { label: "Submit tomorrow's order", link: 'order' }]]
  ]),
  clBuildStarter('starter-handover', 'handover', 'Handover (starter)', [
    ['Handover', [{ label: 'Shortages reviewed', link: 'stock85' }, 'Unfinished prep noted',
      { label: 'Expected deliveries', link: 'receive' }, 'Open issues reviewed']]
  ])
];
const clIsStarterId = id => CL_STARTERS.some(t => t.id === id);

function clCleanNumberLimits(raw) {
  let min = clNum(raw.min), max = clNum(raw.max);
  if (min !== null && max !== null && min > max) [min, max] = [max, min];
  return { min, max };
}

function clCleanTask(raw, sectionIds, index) {
  if (!clIsPlain(raw) || !clId(raw.id) || !sectionIds.has(raw.sectionId)) return null;
  const label = clStr(raw.label, CL_LIMITS.label);
  if (!label) return null;
  const kind = raw.kind === 'number' ? 'number' : 'check';
  const limits = kind === 'number' ? clCleanNumberLimits(raw) : { min: null, max: null };
  return {
    id: raw.id, sectionId: raw.sectionId, label, kind,
    unit: kind === 'number' ? clStr(raw.unit, CL_LIMITS.unit) : '', min: limits.min, max: limits.max,
    required: raw.required !== false, order: Number.isInteger(raw.order) ? raw.order : index,
    link: Object.prototype.hasOwnProperty.call(CL_LINKS, raw.link) ? raw.link : ''
  };
}

/* Shared by templates and run snapshots: sections + tasks with unique ids. */
function clCleanBody(raw) {
  const seen = new Set();
  const sections = (Array.isArray(raw.sections) ? raw.sections : []).slice(0, CL_LIMITS.sections)
    .filter(s => clIsPlain(s) && clId(s.id) && !seen.has(s.id) && seen.add(s.id))
    .map((s, i) => ({ id: s.id, name: clStr(s.name, CL_LIMITS.name) || 'Section', order: Number.isInteger(s.order) ? s.order : i }));
  const sectionIds = new Set(sections.map(s => s.id)), taskIds = new Set();
  const tasks = (Array.isArray(raw.tasks) ? raw.tasks : []).slice(0, CL_LIMITS.tasks)
    .map((t, i) => clCleanTask(t, sectionIds, i))
    .filter(t => t && !taskIds.has(t.id) && taskIds.add(t.id));
  return { sections, tasks };
}

function clCleanTemplate(raw) {
  if (!clIsPlain(raw) || !clId(raw.id) || !CL_TYPES.includes(raw.type)) return null;
  const body = clCleanBody(raw);
  if (!body.tasks.length) return null;
  return {
    id: raw.id, type: raw.type, name: clStr(raw.name, CL_LIMITS.name) || CL_TYPE_NAMES[raw.type],
    version: Number.isInteger(raw.version) && raw.version > 0 ? raw.version : 1,
    updatedAt: clIso(raw.updatedAt) || new Date().toISOString(), deletedAt: clIso(raw.deletedAt),
    sections: body.sections, tasks: body.tasks
  };
}

function clCleanSettings(raw, templates) {
  const src = clIsPlain(raw) ? raw : {}, active = {};
  const live = new Set(templates.filter(t => !t.deletedAt).map(t => t.id));
  for (const type of CL_TYPES) {
    const wanted = clIsPlain(src.active) ? src.active[type] : null;
    const template = templates.find(t => t.id === wanted);
    active[type] = template && live.has(wanted) && template.type === type ? wanted : 'starter-' + type;
  }
  return {
    dayCutoff: CL_CUTOFF_RE.test(src.dayCutoff) ? src.dayCutoff : CL_DEFAULT_CUTOFF,
    active, lastStaff: clStr(src.lastStaff, CL_LIMITS.staff)
  };
}

/* The optional `checklists` block of the main db (templates, settings, PIN). Never throws. */
function clCleanState(raw) {
  const src = clIsPlain(raw) ? raw : {}, seen = new Set();
  /* Live templates first, so deleted ones never push a live one past the limit. */
  const templates = (Array.isArray(src.templates) ? src.templates : []).slice(0, CL_LIMITS.templates * 4)
    .map(clCleanTemplate)
    .filter(t => t && !clIsStarterId(t.id) && !seen.has(t.id) && seen.add(t.id))
    .sort((a, b) => Number(!!a.deletedAt) - Number(!!b.deletedAt))
    .slice(0, CL_LIMITS.templates);
  const pin = clIsPlain(src.pin) && /^[0-9a-f]{64}$/.test(src.pin.hash) && /^[0-9a-f]{32}$/.test(src.pin.salt)
    ? { hash: src.pin.hash, salt: src.pin.salt } : null;
  return {
    templates, settings: clCleanSettings(src.settings, templates), pin, deviceId: clId(src.deviceId),
    orderGuards: clCleanGuards(src.orderGuards, Date.now())
  };
}

/* "Added to order draft" guards keyed runId:taskId. They live in db.checklists so the guard and the
   draft line are saved in the same localStorage write; a week is far longer than any open run. */
function clCleanGuards(raw, now) {
  const out = {};
  if (!clIsPlain(raw)) return out;
  for (const [key, guard] of Object.entries(raw)) {
    const [runId, taskId] = key.split(':');
    const at = clIsPlain(guard) ? clIso(guard.at) : null;
    if (clId(runId) && clId(taskId) && at && now - Date.parse(at) < CL_GUARD_KEEP_MS && clId(guard.itemId) && clNum(guard.qty) !== null) {
      out[key] = { itemId: guard.itemId, qty: guard.qty, at };
    }
  }
  return out;
}

function clCleanOrderAdds(raw) {
  const out = {};
  if (!clIsPlain(raw)) return out;
  for (const [taskId, add] of Object.entries(raw)) {
    if (clId(taskId) && clIsPlain(add) && clId(add.itemId) && clNum(add.qty) !== null && clIso(add.at)) {
      out[taskId] = { itemId: add.itemId, qty: add.qty, at: add.at };
    }
  }
  return out;
}

function clCleanRun(raw) {
  if (!clIsPlain(raw) || !clId(raw.id) || !clId(raw.templateId) || !clIsPlain(raw.snapshot)) return null;
  const type = CL_TYPES.includes(raw.type) ? raw.type : null, startedAt = clIso(raw.startedAt);
  const body = clCleanBody(raw.snapshot);
  if (!type || !startedAt || !clValidDate(raw.businessDate) || !body.tasks.length) return null;
  const ackName = clIsPlain(raw.ack) ? clStr(raw.ack.name, CL_LIMITS.staff) : '';
  return {
    id: raw.id, templateId: raw.templateId, templateVersion: Number.isInteger(raw.templateVersion) ? raw.templateVersion : 1,
    type, snapshot: { name: clStr(raw.snapshot.name, CL_LIMITS.name) || CL_TYPE_NAMES[type], ...body },
    businessDate: raw.businessDate, startedAt, completedAt: clIso(raw.completedAt),
    staffName: clStr(raw.staffName, CL_LIMITS.staff), deviceId: clId(raw.deviceId) || '',
    ack: ackName && clIso(raw.ack.at) ? { name: ackName, at: raw.ack.at } : null,
    orderAdds: clCleanOrderAdds(raw.orderAdds)
  };
}

function clCleanEntry(raw) {
  if (!clIsPlain(raw) || !clId(raw.id) || !clId(raw.runId) || !clId(raw.taskId)) return null;
  if (!CL_STATES.includes(raw.state) || !clIso(raw.at)) return null;
  return {
    id: raw.id, runId: raw.runId, taskId: raw.taskId, state: raw.state, value: clNum(raw.value),
    note: clStr(raw.note, CL_LIMITS.note), nextAction: clStr(raw.nextAction, CL_LIMITS.nextAction),
    byName: clStr(raw.byName, CL_LIMITS.staff), at: raw.at
  };
}

function clZonedParts(date) {
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: CL_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return Object.fromEntries(format.formatToParts(date).map(part => [part.type, part.value]));
}

/* A shift that ends after midnight belongs to the day it started: before the cutoff, use yesterday. */
function clBusinessDate(date, cutoff) {
  const p = clZonedParts(date), time = p.hour + ':' + p.minute;
  if (time >= (CL_CUTOFF_RE.test(cutoff) ? cutoff : CL_DEFAULT_CUTOFF)) return `${p.year}-${p.month}-${p.day}`;
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day - 1)).toISOString().slice(0, 10);
}

function clShiftDate(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/* Sections in order, each with its tasks in order. */
function clOrdered(body) {
  const byOrder = (a, b) => a.order - b.order;
  return [...body.sections].sort(byOrder).map(section => ({
    section, tasks: body.tasks.filter(t => t.sectionId === section.id).sort(byOrder)
  }));
}

/* Latest entry per task wins; an issue stays open until a later `resolved` entry. */
function clTaskStates(entries) {
  const map = new Map();
  for (const entry of [...entries].sort(clByAt)) {
    const cur = map.get(entry.taskId) || { state: 'undone', last: null, issue: null };
    cur.state = entry.state;
    cur.last = entry;
    if (entry.state === 'issue') cur.issue = entry;
    if (entry.state === 'resolved') cur.issue = null;
    map.set(entry.taskId, cur);
  }
  return map;
}

function clProgress(run, entries) {
  const states = clTaskStates(entries), groups = clOrdered(run.snapshot);
  const tasks = groups.flatMap(g => g.tasks), stateOf = t => (states.get(t.id) || { state: 'undone' }).state;
  const handled = tasks.filter(t => CL_HANDLED.includes(stateOf(t)));
  return {
    states, groups, total: tasks.length, done: handled.length,
    next: tasks.find(t => !CL_HANDLED.includes(stateOf(t))) || null,
    requiredLeft: tasks.filter(t => t.required && !CL_HANDLED.includes(stateOf(t))),
    openIssues: tasks.filter(t => states.get(t.id)?.issue).map(task => ({ task, entry: states.get(task.id).issue }))
  };
}

/* Returns a message when a reading is outside the task's limits, otherwise ''. */
function clRangeProblem(task, value) {
  const tooLow = task.min !== null && value < task.min, tooHigh = task.max !== null && value > task.max;
  if (!tooLow && !tooHigh) return '';
  const range = task.min !== null && task.max !== null ? `${task.min}–${task.max}` : task.min !== null ? `at least ${task.min}` : `at most ${task.max}`;
  return `Reading ${value}${task.unit ? ' ' + task.unit : ''} is outside ${range}${task.unit ? ' ' + task.unit : ''}.`;
}

/* Copy with fresh ids so the copy can be edited without touching its source. */
function clDuplicate(source, newId, now) {
  const sectionMap = new Map(source.sections.map(s => [s.id, newId()]));
  return {
    id: newId(), type: source.type, name: clStr('Copy of ' + source.name.replace(/ \(starter\)$/, ''), CL_LIMITS.name),
    version: 1, updatedAt: now, deletedAt: null,
    sections: source.sections.map(s => ({ ...s, id: sectionMap.get(s.id) })),
    tasks: source.tasks.map(t => ({ ...t, id: newId(), sectionId: sectionMap.get(t.sectionId) }))
  };
}
