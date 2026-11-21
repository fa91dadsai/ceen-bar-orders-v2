'use strict';
/* Checklists v1 — editing: open a checklist's tasks straight from its card, create custom checklists,
   day-cutoff setting. Single-user app: no PIN. Loaded last of the checklist files, so it starts the feature. */
const CL_APPLY_NOTE = 'Changes apply the next time you start this checklist.';

function clLiveTemplateCount() {
  return clState().templates.filter(t => !t.deletedAt).length;
}

function clSettingsDialog() {
  clDialog('Checklist settings', clField('clCutoff', 'Business day starts at', `<input id="clCutoff" type="time" value="${esc(clState().settings.dayCutoff)}">`) +
    '<p class="hint">Work before this time counts for the previous day (a 02:00 close belongs to yesterday).</p>',
    `${clCancel}<button type="button" class="primary" data-clact="cutoff">Save</button>`);
}

function clSaveCutoff() {
  const value = $('clCutoff').value;
  if (!CL_CUTOFF_RE.test(value)) return clError('Pick a time such as 06:00.');
  clState().settings.dayCutoff = value;
  if (!clSave()) return;
  clCloseDialog();
  notify('Business day now starts at ' + value + '.');
  clRefresh();
}

function clNewListDialog() {
  clDialog('New checklist', clField('clListName', 'Name', `<input id="clListName" maxlength="${CL_LIMITS.customName}" autocomplete="off" dir="auto" placeholder="e.g. Deep clean">`),
    `${clCancel}<button type="button" class="primary" data-clact="newlistgo">Create</button>`);
}

function clNewListCreate() {
  const name = clStr($('clListName').value, CL_LIMITS.customName + 1);
  if (name.length < 2 || name.length > CL_LIMITS.customName) return clError(`Use 2 to ${CL_LIMITS.customName} characters.`);
  if (clLiveTemplateCount() >= CL_LIMITS.templates) return clError('Delete a checklist before adding another.');
  if (!clCanSave()) return clSave();
  const template = clCleanTemplate({
    id: clNewId(), type: 'custom', name, version: 1, updatedAt: clNow(), deletedAt: null,
    sections: [{ id: clNewId(), name: 'Tasks', order: 0 }], tasks: []
  });
  clState().templates.push(template);
  if (!clSave()) return;
  clCloseDialog();
  go('checklistsedit/' + template.id);
}

function clEditLimits(task) {
  if (task.kind !== 'number') return '';
  const box = (field, label, value) => `<label class="cl-ed-mini">${label}<input data-cled="${field}" data-task="${esc(task.id)}" value="${esc(value ?? '')}" inputmode="decimal" maxlength="12"></label>`;
  return `<div class="cl-ed-grid">${box('unit', 'Unit', task.unit)}${box('min', 'Min', task.min)}${box('max', 'Max', task.max)}</div>`;
}

function clEditTask(task) {
  const id = esc(task.id), on = (a, b) => (a === b ? ' selected' : '');
  const links = ['', ...Object.keys(CL_LINKS)].map(k => `<option value="${k}"${on(task.link, k)}>${k ? 'Link: ' + CL_LINKS[k] : 'No link'}</option>`).join('');
  return `<div class="cl-ed-task"><input class="cl-ed-label" data-cled="label" data-task="${id}" value="${esc(task.label)}" maxlength="${CL_LIMITS.label}" aria-label="Task" dir="auto">` +
    `<div class="cl-ed-grid"><select data-cled="kind" data-task="${id}" aria-label="Kind"><option value="check"${on(task.kind, 'check')}>Tick</option><option value="number"${on(task.kind, 'number')}>Number</option></select>` +
    `<select data-cled="link" data-task="${id}" aria-label="Link">${links}</select>` +
    `<label class="cl-ed-mini cl-ed-check"><input type="checkbox" data-cled="required" data-task="${id}"${task.required ? ' checked' : ''}>Required</label></div>${clEditLimits(task)}` +
    `<div class="cl-type-btns"><button type="button" data-clact="edmove" data-task="${id}" data-dir="-1" aria-label="Move up">↑</button><button type="button" data-clact="edmove" data-task="${id}" data-dir="1" aria-label="Move down">↓</button>` +
    `<button type="button" class="danger-text" data-clact="eddeltask" data-task="${id}">Remove</button></div></div>`;
}

function clEditSection(group) {
  const id = esc(group.section.id);
  return `<fieldset class="cl-ed-sec"><input class="cl-ed-label" data-cled="secname" data-sec="${id}" value="${esc(group.section.name)}" maxlength="${CL_LIMITS.name}" aria-label="Section name" dir="auto">` +
    `<div class="cl-type-btns"><button type="button" data-clact="edmove" data-sec="${id}" data-dir="-1" aria-label="Move section up">↑</button><button type="button" data-clact="edmove" data-sec="${id}" data-dir="1" aria-label="Move section down">↓</button>` +
    `<button type="button" class="danger-text" data-clact="eddelsec" data-sec="${id}">Remove section</button></div>` +
    group.tasks.map(clEditTask).join('') + `<button type="button" class="ghost" data-clact="edaddtask" data-sec="${id}">+ Add task</button></fieldset>`;
}

/* Built-ins whose active template is a starter are edited as an unsaved copy; the first Save stores it. */
function clEditDraftFor(key, card) {
  if (CL.editDraft && CL.editKey === key) return CL.editDraft;
  CL.editKey = key;
  CL.editSection = null;
  CL.editDraft = clIsStarterId(card.template.id) ? clDuplicate(card.template, clNewId, clNow()) : clone(card.template);
  return CL.editDraft;
}

function clEditDanger(card) {
  if (card.type === 'custom') return '<button type="button" class="danger-text" data-clact="eddelete">Delete checklist</button>';
  if (clIsStarterId(card.template.id)) return '';
  return '<button type="button" class="danger-text" data-clact="edreset">Reset to default</button>';
}

function clEditPage(key) {
  const card = clCardByKey(key);
  if (!card) return clHubPage();
  const draft = clEditDraftFor(key, card), maxName = card.type === 'custom' ? CL_LIMITS.customName : CL_LIMITS.name;
  footer('<button type="button" data-clact="edcancel">Cancel</button><button type="button" class="primary" data-clact="edsave">Save</button>');
  return `${rcvBar('checklists', 'Edit ' + card.title, '')}<p class="hint cl-ed-note">${CL_APPLY_NOTE}</p>` +
    clField('clTplName', 'Checklist name', `<input id="clTplName" data-cled="name" value="${esc(draft.name)}" maxlength="${maxName}" dir="auto">`) +
    clOrdered(draft).map(clEditSection).join('') +
    '<div class="toolbar-row"><button type="button" class="ghost" data-clact="edaddsec">+ Add section</button><button type="button" data-clact="libopen">+ Add from library</button></div>' +
    `<div class="toolbar-row">${clEditDanger(card)}</div>`;
}

/* Reorder by swapping `order` with the neighbour; orders are renumbered first so they stay unique. */
function clMove(list, id, dir) {
  list.sort((a, b) => a.order - b.order).forEach((x, i) => { x.order = i; });
  const index = list.findIndex(x => x.id === id), other = list[index + dir];
  if (index < 0 || !other) return;
  [list[index].order, other.order] = [other.order, list[index].order];
}

function clEditInput(el) {
  const draft = CL.editDraft, field = el.dataset.cled;
  if (!draft) return;
  if (field === 'name') draft.name = el.value;
  if (field === 'secname') draft.sections.find(s => s.id === el.dataset.sec).name = el.value;
  const task = el.dataset.task && draft.tasks.find(t => t.id === el.dataset.task);
  if (!task) return;
  if (field === 'label' || field === 'unit' || field === 'kind' || field === 'link') task[field] = el.value;
  if (field === 'required') task.required = el.checked;
  if (field === 'min' || field === 'max') task[field] = el.value.trim() === '' ? null : Number(el.value.replace(',', '.'));
}

function clEditProblem(draft) {
  if (clStr(draft.name, CL_LIMITS.name).length < 2) return 'Give the checklist a name (at least 2 characters).';
  if (!draft.tasks.length) return 'Add at least one task.';
  if (draft.tasks.some(t => !clStr(t.label, CL_LIMITS.label))) return 'Every task needs a name.';
  if (draft.tasks.some(t => t.kind === 'number' && [t.min, t.max].some(v => v !== null && !Number.isFinite(v)))) return 'Min and max must be numbers.';
  return '';
}

function clEditSave() {
  const draft = CL.editDraft;
  if (!draft) return;
  if (!clCanSave()) return clSave();
  const problem = clEditProblem(draft);
  if (problem) return notify(problem);
  const list = clState().templates, index = list.findIndex(t => t.id === draft.id);
  if (index < 0 && clLiveTemplateCount() >= CL_LIMITS.templates) return notify('Delete a checklist before adding another.');
  const saved = clCleanTemplate({ ...draft, version: index < 0 ? 1 : list[index].version + 1, updatedAt: clNow() });
  if (!saved) return notify('This checklist could not be saved.');
  if (index < 0) list.push(saved);
  else list[index] = saved;
  if (saved.type !== 'custom') clState().settings.active[saved.type] = saved.id;
  clState().settings = clCleanSettings(clState().settings, list);
  CL.editDraft = null;
  if (!clSave()) return;
  notify('Saved. ' + CL_APPLY_NOTE);
  go('checklists');
}

/* Reset (built-in) and Delete (custom) are soft deletes: past runs keep their own snapshot. */
function clEditRemove(ds) {
  const card = clCardByKey(CL.editKey), isReset = ds.clact === 'edreset';
  if (!card || clIsStarterId(card.template.id)) return;
  const question = isReset ? `Reset ${card.title} to the default tasks? Your changes are removed; past checklists keep theirs.`
    : `Delete ${card.title}? Past checklists stay in History.`;
  if (!confirm(question)) return;
  if (!clCanSave()) return clSave();
  card.template.deletedAt = clNow();
  clState().settings = clCleanSettings(clState().settings, clState().templates);
  CL.editDraft = null;
  if (!clSave()) return;
  notify(isReset ? `${card.title} uses the default tasks again.` : `${card.title} deleted.`);
  go('checklists');
}

function clEditStructure(ds) {
  const draft = CL.editDraft;
  if (!draft) return;
  const action = ds.clact, dir = Number(ds.dir);
  if (action === 'edaddsec') draft.sections.push({ id: clNewId(), name: 'New section', order: draft.sections.length });
  if (action === 'edaddtask') draft.tasks.push({ id: clNewId(), sectionId: ds.sec, label: 'New task', kind: 'check', unit: '', min: null, max: null, required: true, order: draft.tasks.length, link: '', sourceId: '' });
  if (action === 'edaddtask') CL.editSection = ds.sec;
  if (action === 'eddeltask') draft.tasks = draft.tasks.filter(t => t.id !== ds.task);
  if (action === 'eddelsec') {
    draft.sections = draft.sections.filter(s => s.id !== ds.sec);
    draft.tasks = draft.tasks.filter(t => t.sectionId !== ds.sec);
  }
  if (action === 'edmove' && ds.sec) clMove(draft.sections, ds.sec, dir);
  if (action === 'edmove' && ds.task) {
    const task = draft.tasks.find(t => t.id === ds.task);
    clMove(draft.tasks.filter(t => t.sectionId === task.sectionId), ds.task, dir);
  }
  clRefresh();
}

Object.assign(CL_ACTIONS, {
  settings: clSettingsDialog, cutoff: clSaveCutoff, newlist: clNewListDialog, newlistgo: clNewListCreate,
  edsave: clEditSave, edreset: clEditRemove, eddelete: clEditRemove,
  edaddsec: clEditStructure, edaddtask: clEditStructure, eddeltask: clEditStructure, eddelsec: clEditStructure, edmove: clEditStructure,
  edcancel: () => {
    CL.editDraft = null;
    go('checklists');
  }
});

document.addEventListener('input', e => {
  if (e.target.dataset && e.target.dataset.cled) clEditInput(e.target);
});

document.addEventListener('change', e => {
  if (!e.target.dataset || !e.target.dataset.cled) return;
  clEditInput(e.target);
  if (e.target.dataset.cled === 'kind') clRefresh();
});

/* Remembers the section being edited, so library tasks go there by default. */
document.addEventListener('focusin', e => {
  const el = e.target.closest && e.target.closest('[data-sec],[data-task]');
  if (!el || !CL.editDraft) return;
  const task = el.dataset.task && CL.editDraft.tasks.find(t => t.id === el.dataset.task);
  CL.editSection = el.dataset.sec || (task && task.sectionId) || CL.editSection;
});

clInit();
