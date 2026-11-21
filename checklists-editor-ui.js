'use strict';
/* Checklists — editor rows and sheets. Each task is one compact row; its details are edited in a
   bottom-sheet dialog that works on a copy, so Cancel/× discards and Done writes into the editor draft.
   The editor's Save (checklists-manage.js) still decides what is stored. */
const CL_TASK_PLACEHOLDER = 'Type the task, e.g. Check fire exit';
const CL_PEN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/></svg>';
const CL_LINK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/></svg>';

function clEditTask(task) {
  const id = esc(task.id), name = task.label || 'Untitled task';
  const hints = (task.required ? '<span class="cl-ed-dot" title="Required" aria-label="Required"></span>' : '') +
    (task.kind === 'number' ? `<span class="cl-ed-unit">${esc(task.unit || '#')}</span>` : '') +
    (task.link ? `<span class="cl-ed-linkic" title="${esc('Link: ' + CL_LINKS[task.link])}">${CL_LINK_ICON}</span>` : '');
  return `<div class="cl-ed-row"><button type="button" class="cl-ed-main" data-clact="edtask" data-task="${id}"><span class="cl-ed-name">${esc(name)}</span>` +
    `<span class="cl-ed-hints">${hints}</span></button><button type="button" class="cl-ed-pen" data-clact="edtask" data-task="${id}" aria-label="${esc('Edit task: ' + name)}">${CL_PEN}</button></div>`;
}

function clEditSection(group) {
  const id = esc(group.section.id);
  return `<section class="cl-ed-sec"><div class="cl-ed-sechead"><b>${esc(group.section.name)}</b><span>${group.tasks.length}</span>` +
    `<button type="button" class="cl-ed-pen" data-clact="edsec" data-sec="${id}" aria-label="${esc('Edit section: ' + group.section.name)}">${CL_PEN}</button></div>` +
    group.tasks.map(clEditTask).join('') + `<button type="button" class="ghost cl-ed-add" data-clact="edaddtask" data-sec="${id}">+ Add task</button></section>`;
}

/* Moves within the task's own section (tasks) or the section list. */
function clEditMove(kind, id, dir) {
  const draft = CL.editDraft;
  if (kind === 'sec') return clMove(draft.sections, id, dir);
  const task = draft.tasks.find(t => t.id === id);
  if (task) clMove(draft.tasks.filter(t => t.sectionId === task.sectionId), id, dir);
}

function clTaskFields(task) {
  const on = (a, b) => (a === b ? ' selected' : '');
  const links = ['', ...Object.keys(CL_LINKS)].map(k => `<option value="${k}"${on(task.link, k)}>${k ? CL_LINKS[k] : 'No link'}</option>`).join('');
  const box = (id, label, value) => `<label class="cl-ed-mini" for="${id}">${label}<input id="${id}" value="${esc(value ?? '')}" inputmode="decimal" maxlength="12"></label>`;
  const number = task.kind === 'number' ? `<div class="cl-ed-grid">${box('clTkUnit', 'Unit', task.unit)}${box('clTkMin', 'Min', task.min)}${box('clTkMax', 'Max', task.max)}</div>` : '';
  return clField('clTkName', 'Task name', `<input id="clTkName" value="${esc(task.label)}" maxlength="${CL_LIMITS.label}" autocomplete="off" dir="auto" placeholder="${CL_TASK_PLACEHOLDER}">`) +
    `<div class="cl-ed-grid cl-ed-grid2">${clField('clTkKind', 'Type', `<select id="clTkKind"><option value="check"${on(task.kind, 'check')}>Tick</option><option value="number"${on(task.kind, 'number')}>Number</option></select>`)}` +
    `${clField('clTkLink', 'Link', `<select id="clTkLink">${links}</select>`)}</div>${number}` +
    `<label class="cl-ed-toggle"><input type="checkbox" id="clTkReq"${task.required ? ' checked' : ''}><span>Required</span></label>`;
}

function clTaskDialog() {
  const form = CL.taskForm, task = form.task;
  const order = form.isNew ? '' : '<div class="cl-type-btns cl-ed-moves"><button type="button" data-clact="tkmove" data-dir="-1">Move up</button>' +
    '<button type="button" data-clact="tkmove" data-dir="1">Move down</button><button type="button" class="danger-text" data-clact="tkremove">Remove</button></div>';
  clDialog(form.isNew ? 'New task' : 'Edit task', `<div id="clTkBody">${clTaskFields(task)}</div>${order}`,
    `<button type="button" data-close="clDialog">Cancel</button><button type="button" class="primary" data-clact="tkdone">Done</button>`);
}

/* Copies the sheet's inputs into the working copy (not the draft). */
function clTaskRead() {
  const task = CL.taskForm.task, num = id => ($(id) && $(id).value.trim() !== '' ? Number($(id).value.replace(',', '.')) : null);
  task.label = $('clTkName').value;
  task.kind = $('clTkKind').value === 'number' ? 'number' : 'check';
  task.link = $('clTkLink').value;
  task.required = $('clTkReq').checked;
  if ($('clTkUnit')) Object.assign(task, { unit: $('clTkUnit').value, min: num('clTkMin'), max: num('clTkMax') });
}

function clTaskOpen(ds) {
  const draft = CL.editDraft, task = draft && draft.tasks.find(t => t.id === ds.task);
  if (!task) return;
  CL.editSection = task.sectionId;
  CL.taskForm = { isNew: false, task: clone(task) };
  clTaskDialog();
}

function clTaskAdd(ds) {
  const draft = CL.editDraft;
  if (!draft) return;
  const full = clLimitProblem(draft, 0, 1);
  if (full) return notify(full);
  CL.editSection = ds.sec;
  CL.taskForm = { isNew: true, task: { id: clNewId(), sectionId: ds.sec, label: '', kind: 'check', unit: '', min: null, max: null, required: true, order: draft.tasks.length, link: '', sourceId: '' } };
  clTaskDialog();
}

function clTaskDone() {
  clTaskRead();
  const draft = CL.editDraft, task = CL.taskForm.task;
  task.label = clStr(task.label, CL_LIMITS.label);
  if (!task.label) {
    $('clTkName').focus();
    return clError('Type the task name, or tap Cancel.');
  }
  if (task.kind === 'number' && [task.min, task.max].some(v => v !== null && !Number.isFinite(v))) return clError('Min and max must be numbers.');
  const index = draft.tasks.findIndex(t => t.id === task.id);
  if (index < 0) {
    const full = clLimitProblem(draft, 0, 1);
    if (full) return clError(full);
    draft.tasks.push(task);
  } else draft.tasks[index] = task;
  clCloseDialog();
  clRefresh();
}

function clTaskMove(ds) {
  clTaskRead();
  const id = CL.taskForm.task.id;
  clEditMove('task', id, Number(ds.dir));
  const moved = CL.editDraft.tasks.find(t => t.id === id);
  CL.taskForm.task.order = moved.order;
  clRefresh();
}

function clTaskRemove() {
  const task = CL.taskForm.task;
  if (!confirm(`Remove "${task.label || 'this task'}"?`)) return;
  CL.editDraft.tasks = CL.editDraft.tasks.filter(t => t.id !== task.id);
  clCloseDialog();
  clRefresh();
}

function clSectionDialog() {
  const form = CL.secForm;
  const extra = form.isNew ? '' : '<div class="cl-type-btns cl-ed-moves"><button type="button" data-clact="secmove" data-dir="-1">Move up</button>' +
    '<button type="button" data-clact="secmove" data-dir="1">Move down</button><button type="button" class="danger-text" data-clact="secremove">Remove section</button></div>';
  clDialog(form.isNew ? 'New section' : 'Edit section',
    clField('clSecName', 'Section name', `<input id="clSecName" value="${esc(form.name)}" maxlength="${CL_LIMITS.name}" autocomplete="off" dir="auto" placeholder="e.g. Bar">`) + extra,
    `<button type="button" data-close="clDialog">Cancel</button><button type="button" class="primary" data-clact="secdone">Done</button>`);
}

function clSectionOpen(ds) {
  const section = CL.editDraft && CL.editDraft.sections.find(s => s.id === ds.sec);
  if (!section) return;
  CL.secForm = { isNew: false, id: section.id, name: section.name };
  clSectionDialog();
}

function clSectionAdd() {
  const draft = CL.editDraft;
  if (!draft) return;
  const full = clLimitProblem(draft, 1, 0);
  if (full) return notify(full);
  CL.secForm = { isNew: true, id: clNewId(), name: '' };
  clSectionDialog();
}

function clSectionDone() {
  const draft = CL.editDraft, form = CL.secForm, name = clStr($('clSecName').value, CL_LIMITS.name);
  if (!name) return clError('Type a section name, or tap Cancel.');
  const section = draft.sections.find(s => s.id === form.id);
  if (section) section.name = name;
  else draft.sections.push({ id: form.id, name, order: draft.sections.length });
  CL.editSection = form.id;
  clCloseDialog();
  clRefresh();
}

function clSectionRemove() {
  const draft = CL.editDraft, form = CL.secForm, count = draft.tasks.filter(t => t.sectionId === form.id).length;
  if (!confirm(`Remove section "${form.name}"${count ? ` and its ${clPlural(count, 'task')}` : ''}?`)) return;
  draft.sections = draft.sections.filter(s => s.id !== form.id);
  draft.tasks = draft.tasks.filter(t => t.sectionId !== form.id);
  clCloseDialog();
  clRefresh();
}

Object.assign(CL_ACTIONS, {
  edtask: clTaskOpen, edaddtask: clTaskAdd, tkdone: clTaskDone, tkmove: clTaskMove, tkremove: clTaskRemove,
  edsec: clSectionOpen, edaddsec: clSectionAdd, secdone: clSectionDone, secremove: clSectionRemove,
  secmove: ds => {
    clEditMove('sec', CL.secForm.id, Number(ds.dir));
    clRefresh();
  }
});

/* Switching Tick/Number redraws the sheet fields, keeping what was typed. */
document.addEventListener('change', e => {
  if (e.target.id !== 'clTkKind' || !CL.taskForm) return;
  clTaskRead();
  $('clTkBody').innerHTML = clTaskFields(CL.taskForm.task);
  $('clTkKind').focus();
});
