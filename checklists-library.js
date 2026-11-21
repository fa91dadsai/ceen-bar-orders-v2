'use strict';
/* Checklists — shared task library (tasks-global.json, draft list). Loaded on first use, like
   recipes-global.json. Adding copies a task into the checklist being edited; the copy is fully editable. */
const CL_LIB_URL = 'tasks-global.json';
const CL_LIB_MAX = 1000;
const clLibNorm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

function clLibCleanTask(raw, seen) {
  if (!clIsPlain(raw) || !clId(raw.id) || seen.has(raw.id)) return null;
  const label = clStr(raw.label, CL_LIMITS.label);
  if (!label) return null;
  seen.add(raw.id);
  const kind = raw.kind === 'number' ? 'number' : 'check';
  const limits = kind === 'number' ? clCleanNumberLimits(raw) : { min: null, max: null };
  return {
    id: raw.id, group: clStr(raw.group, CL_LIMITS.name) || 'Other', label, kind,
    unit: kind === 'number' ? clStr(raw.unit, CL_LIMITS.unit) : '', min: limits.min, max: limits.max,
    link: Object.prototype.hasOwnProperty.call(CL_LINKS, raw.link) ? raw.link : '', key: clLibNorm(label)
  };
}

function clLibClean(raw) {
  if (!clIsPlain(raw) || !Array.isArray(raw.tasks)) throw new Error('Unexpected task library file');
  const seen = new Set();
  return raw.tasks.slice(0, CL_LIB_MAX).map(t => clLibCleanTask(t, seen)).filter(Boolean);
}

/* Fetch once; after a failure the next open tries again. */
function clLibLoad() {
  if (CL.lib && CL.lib.state !== 'error') return;
  CL.lib = { state: 'loading', tasks: [], query: CL.lib ? CL.lib.query : '', closed: CL.lib ? CL.lib.closed : new Set() };
  fetch(CL_LIB_URL)
    .then(response => {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    })
    .then(json => {
      CL.lib.tasks = clLibClean(json);
      CL.lib.state = 'ok';
    })
    .catch(error => {
      console.warn('Task library unavailable', error);
      CL.lib.state = 'error';
    })
    .then(clLibRefresh);
}

function clLibTaken(task) {
  return CL.editDraft.tasks.some(t => t.sourceId === task.id || clLibNorm(t.label) === task.key);
}

function clLibRow(task) {
  const taken = clLibTaken(task), range = task.kind === 'number' ? `${clRangeText(task.min, task.max)} ${task.unit}`.trim() : '';
  const detail = [task.link ? 'Link: ' + CL_LINKS[task.link] : '', range].filter(Boolean).join(' · ');
  return `<button type="button" class="cl-pick cl-lib-row${taken ? ' is-done' : ''}" data-clact="libadd" data-lib="${esc(task.id)}"${taken ? ' disabled' : ''}>` +
    `<span class="cl-box" aria-hidden="true">${taken ? '✓' : '+'}</span><span class="cl-label"><b>${esc(task.label)}</b>` +
    `${detail ? `<small>${esc(detail)}</small>` : ''}</span></button>`;
}

function clLibListHtml() {
  const lib = CL.lib;
  if (!lib || lib.state === 'loading') return '<p class="av-empty">Loading the task library…</p>';
  if (lib.state === 'error') {
    return '<p class="error">The task library could not be loaded. Check your connection and try again. It also needs the app to be opened from its web link.</p>' +
      '<button type="button" data-clact="libretry">Try again</button>';
  }
  const query = clLibNorm(lib.query), hits = lib.tasks.filter(t => !query || t.key.includes(query));
  if (!hits.length) return '<p class="av-empty">No task matches your search.</p>';
  const groups = [...new Set(hits.map(t => t.group))];
  return groups.map(group => {
    const rows = hits.filter(t => t.group === group), open = query || !lib.closed.has(group);
    return `<details class="cl-sec cl-lib-grp" data-clgrp="${esc(group)}"${open ? ' open' : ''}><summary><b>${esc(group)}</b><span>${rows.length}</span></summary>` +
      rows.map(clLibRow).join('') + '</details>';
  }).join('');
}

function clLibRefresh() {
  const box = $('clLibList');
  if (box) box.innerHTML = clLibListHtml();
}

function clLibOpen() {
  const draft = CL.editDraft;
  if (!draft) return;
  if (!draft.sections.length) draft.sections.push({ id: clNewId(), name: 'Tasks', order: 0 });
  const sections = clOrdered(draft).map(g => g.section);
  const chosen = sections.some(s => s.id === CL.editSection) ? CL.editSection : sections[sections.length - 1].id;
  CL.editSection = chosen;
  const options = sections.map(s => `<option value="${esc(s.id)}"${s.id === chosen ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
  clLibLoad();
  clDialog('Task library', clField('clLibSec', 'Add to section', `<select id="clLibSec">${options}</select>`) +
    clField('clLibQ', 'Search', `<input id="clLibQ" type="search" autocomplete="off" placeholder="e.g. fridge, ice, bins" value="${esc(CL.lib.query)}">`) +
    `<div id="clLibList" class="cl-lib-list">${clLibListHtml()}</div>`,
    '<button type="button" class="primary" data-close="clDialog">Done</button>');
}

function clLibAdd(ds) {
  const draft = CL.editDraft, task = CL.lib && CL.lib.tasks.find(t => t.id === ds.lib);
  const sectionId = $('clLibSec') && $('clLibSec').value;
  if (!draft || !task || clLibTaken(task) || !draft.sections.some(s => s.id === sectionId)) return;
  const inSection = draft.tasks.filter(t => t.sectionId === sectionId);
  draft.tasks.push({
    id: clNewId(), sectionId, label: task.label, kind: task.kind, unit: task.unit, min: task.min, max: task.max,
    required: false, order: inSection.length ? Math.max(...inSection.map(t => t.order)) + 1 : 0, link: task.link, sourceId: task.id
  });
  CL.editSection = sectionId;
  clVibrate();
  clRefresh();
  clLibRefresh();
}

Object.assign(CL_ACTIONS, {
  libopen: clLibOpen,
  libadd: clLibAdd,
  libretry: () => {
    clLibLoad();
    clLibRefresh();
  }
});

document.addEventListener('input', e => {
  if (e.target.id !== 'clLibQ' || !CL.lib) return;
  CL.lib.query = e.target.value;
  clLibRefresh();
});

document.addEventListener('change', e => {
  if (e.target.id === 'clLibSec') CL.editSection = e.target.value;
});

/* Group <details> toggle does not bubble; remember collapsed groups (only while not searching). */
document.addEventListener('toggle', e => {
  const group = e.target && e.target.dataset && e.target.dataset.clgrp;
  if (!group || !CL.lib || CL.lib.query) return;
  if (e.target.open) CL.lib.closed.delete(group);
  else CL.lib.closed.add(group);
}, true);
