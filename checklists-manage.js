'use strict';
/* Checklists v1 — editing: open a checklist's tasks straight from its card, create custom checklists,
   day-cutoff setting. Single-user app: no PIN. Loaded last of the checklist files, so it starts the feature. */
const CL_APPLY_NOTE = 'Changes apply the next time you start this checklist.';
function clLiveTemplateCount() {
  return clVisibleTemplateCount(clState());
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

/* At the limit, Add buttons are disabled and a short line says why (Save also refuses over-limit drafts). */
function clEditLimitGuard(html, draft) {
  const fullTasks = draft.tasks.length >= CL_LIMITS.tasks, fullSections = draft.sections.length >= CL_LIMITS.sections;
  let out = html;
  if (fullTasks) out = out.split('data-clact="edaddtask"').join('disabled data-clact="edaddtask"').replace('data-clact="libopen"', 'disabled data-clact="libopen"');
  if (fullSections) out = out.replace('data-clact="edaddsec"', 'disabled data-clact="edaddsec"');
  const notes = [fullTasks ? `the limit of ${CL_LIMITS.tasks} tasks` : '', fullSections ? `the limit of ${CL_LIMITS.sections} sections` : ''].filter(Boolean);
  return notes.length ? `<p class="hint cl-limit" role="status">This checklist has reached ${notes.join(' and ')}.</p>` + out : out;
}

function clEditPage(key) {
  const card = clCardByKey(key);
  if (!card) return clHubPage();
  const draft = clEditDraftFor(key, card), maxName = card.type === 'custom' ? CL_LIMITS.customName : CL_LIMITS.name;
  footer('<button type="button" data-clact="edcancel">Cancel</button><button type="button" class="primary" data-clact="edsave">Save</button>');
  return `${rcvBar('checklists', 'Edit ' + card.title, '')}` + clEditLimitGuard(`<p class="hint cl-ed-note">${CL_APPLY_NOTE}</p>` +
    clField('clTplName', 'Checklist name', `<input id="clTplName" data-cled="name" value="${esc(draft.name)}" maxlength="${maxName}" dir="auto">`) +
    clOrdered(draft).map(clEditSection).join('') +
    '<div class="toolbar-row"><button type="button" class="ghost" data-clact="edaddsec">+ Add section</button><button type="button" data-clact="libopen">+ Add from library</button></div>' +
    `<div class="toolbar-row">${clEditDanger(card)}</div>`, draft);
}

/* Reorder by swapping `order` with the neighbour; orders are renumbered first so they stay unique. */
function clMove(list, id, dir) {
  list.sort((a, b) => a.order - b.order).forEach((x, i) => { x.order = i; });
  const index = list.findIndex(x => x.id === id), other = list[index + dir];
  if (index < 0 || !other) return;
  [list[index].order, other.order] = [other.order, list[index].order];
}

function clEditInput(el) {
  if (CL.editDraft && el.dataset.cled === 'name') CL.editDraft.name = el.value;
}

function clEditProblem(draft) {
  if (clStr(draft.name, CL_LIMITS.name).length < 2) return 'Give the checklist a name (at least 2 characters).';
  if (!draft.tasks.length) return 'Add at least one task.';
  const overLimit = clLimitProblem(draft);
  if (overLimit) return overLimit + ' Remove some before saving.';
  if (draft.tasks.some(t => t.kind === 'number' && [t.min, t.max].some(v => v !== null && !Number.isFinite(v)))) return 'Min and max must be numbers.';
  return '';
}

function clEditSave() {
  const draft = CL.editDraft;
  if (!draft) return;
  if (!clCanSave()) return clSave();
  const unnamed = clOrdered(draft).flatMap(g => g.tasks).find(t => !clStr(t.label, CL_LIMITS.label));
  if (unnamed) {
    clTaskOpen({ task: unnamed.id });
    return clError('This task has no name yet. Type one, or remove the task.');
  }
  const problem = clEditProblem(draft);
  if (problem) return notify(problem);
  const list = clState().templates, index = list.findIndex(t => t.id === draft.id);
  if (index < 0 && clLiveTemplateCount() >= CL_LIMITS.templates) return notify('Delete a checklist before adding another.');
  const saved = clCleanTemplate({ ...draft, version: index < 0 ? 1 : list[index].version + 1, updatedAt: clNow() });
  if (!saved) return notify('This checklist could not be saved.');
  if (index < 0) list.push(saved);
  else list[index] = saved;
  if (saved.type !== 'custom') clState().settings.active[saved.type] = saved.id;
  Object.assign(clState(), clCleanState(clState()));
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
  Object.assign(clState(), clCleanState(clState()));
  CL.editDraft = null;
  if (!clSave()) return;
  notify(isReset ? `${card.title} uses the default tasks again.` : `${card.title} deleted.`);
  go('checklists');
}

Object.assign(CL_ACTIONS, {
  settings: clSettingsDialog, cutoff: clSaveCutoff, newlist: clNewListDialog, newlistgo: clNewListCreate,
  edsave: clEditSave, edreset: clEditRemove, eddelete: clEditRemove,
  edcancel: () => {
    CL.editDraft = null;
    go('checklists');
  }
});

document.addEventListener('input', e => {
  if (e.target.dataset && e.target.dataset.cled) clEditInput(e.target);
});

clInit();
