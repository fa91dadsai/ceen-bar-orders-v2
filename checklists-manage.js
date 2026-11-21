'use strict';
/* Checklists v1 — manager area: 4-digit PIN (salted SHA-256), templates and settings.
   Loaded last of the checklist files, so it also starts the feature (clInit at the bottom). */
const CL_PIN_RE = /^\d{4}$/;
const clHex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');

async function clHashPin(pin, salt) {
  if (!window.crypto || !crypto.subtle) throw new Error('This browser cannot protect a PIN here. Open Barline from its https link.');
  return clHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pin)));
}

const clPinInput = (id, label) => clField(id, label, `<input id="${id}" type="password" inputmode="numeric" maxlength="4" autocomplete="off" pattern="[0-9]*">`);

function clPinDialog() {
  if (!clState().pin) {
    clDialog('Set manager PIN', '<p class="hint">Choose 4 digits. Managers use it to change checklist templates.</p>' + clPinInput('clPin1', 'New PIN') + clPinInput('clPin2', 'Repeat PIN'),
      `${clCancel}<button type="button" class="primary" data-clact="pinset">Set PIN</button>`);
    return;
  }
  clDialog('Manager PIN', clPinInput('clPin1', 'PIN'),
    `<button type="button" data-clact="pinforgot">Forgot PIN</button><button type="button" class="primary" data-clact="pincheck">Unlock</button>`);
}

async function clPinSet() {
  const pin = $('clPin1').value, again = $('clPin2').value;
  if (!CL_PIN_RE.test(pin)) return clError('Use exactly 4 digits.');
  if (pin !== again) return clError('The two PINs do not match.');
  try {
    const salt = clHex(crypto.getRandomValues(new Uint8Array(16)));
    clState().pin = { hash: await clHashPin(pin, salt), salt };
  } catch (error) {
    return clError(error.message);
  }
  if (!clSave()) return;
  CL.unlocked = true;
  clCloseDialog();
  notify('Manager PIN set.');
  go('checklistsmanage');
}

async function clPinCheck() {
  const pin = $('clPin1').value, stored = clState().pin;
  if (!stored) return clPinDialog();
  try {
    if (!CL_PIN_RE.test(pin) || await clHashPin(pin, stored.salt) !== stored.hash) return clError('Wrong PIN.');
  } catch (error) {
    return clError(error.message);
  }
  CL.unlocked = true;
  clCloseDialog();
  go('checklistsmanage');
}

function clPinForgot() {
  clDialog('Reset manager PIN', '<p class="hint">Type the restaurant name exactly as it appears in your profile. Templates stay as they are.</p>' +
    clField('clRest', 'Restaurant name', '<input id="clRest" autocomplete="off" dir="auto">'),
    `${clCancel}<button type="button" class="primary" data-clact="pinreset">Reset PIN</button>`);
}

function clPinReset() {
  const name = rname();
  if (!name) return clError('Set the restaurant name in Edit profile first.');
  if (norm($('clRest').value) !== norm(name)) return clError('That is not the restaurant name.');
  clState().pin = null;
  if (!clSave()) return;
  clPinDialog();
}

function clManageOpen() {
  if (!clCanSave()) return notify('Saved data could not be loaded. Restore a backup before changing templates.');
  if (CL.unlocked) return go('checklistsmanage');
  clPinDialog();
}

function clTemplateRow(template, type) {
  const inUse = clState().settings.active[type] === template.id, isStarter = clIsStarterId(template.id), id = esc(template.id);
  const info = `v${template.version} · ${clPlural(template.tasks.length, 'task')}${isStarter ? ' · read-only' : ' · updated ' + clDateTime(template.updatedAt)}`;
  const buttons = (isStarter ? '' : `<button type="button" data-go="checklistsedit/${id}">Edit</button>`) +
    `<button type="button" data-clact="tpldup" data-tpl="${id}">${isStarter ? 'Duplicate & edit' : 'Duplicate'}</button>` +
    (inUse ? '' : `<button type="button" data-clact="tpluse" data-tpl="${id}">Use</button>`) +
    (isStarter ? '' : `<button type="button" class="danger-text" data-clact="tpldel" data-tpl="${id}">Delete</button>`);
  return `<article class="cl-type"><div><b>${esc(template.name)}${inUse ? ' <span class="cl-pill">In use</span>' : ''}</b><small>${esc(info)}</small></div><div class="cl-type-btns">${buttons}</div></article>`;
}

function clManagePage() {
  if (!CL.unlocked) {
    return `${rcvBar('checklists', 'Checklist templates', 'Manager')}<div class="empty"><p>Managers only.</p><button type="button" class="primary" data-clact="manage">Enter PIN</button></div>`;
  }
  const groups = CL_TYPES.map(type => `<h2 class="home-h">${CL_TYPE_NAMES[type]}</h2>` +
    clTemplates().filter(t => t.type === type).map(t => clTemplateRow(t, type)).join('')).join('');
  return `${rcvBar('checklists', 'Checklist templates', 'Manager')}${groups}<h2 class="home-h">Settings</h2><div class="cl-type"><div>` +
    clField('clCutoff', 'Business day starts at', `<input id="clCutoff" type="time" value="${esc(clState().settings.dayCutoff)}">`) +
    '<small>Work before this time counts for the previous day (a 02:00 close belongs to yesterday).</small></div>' +
    '<div class="cl-type-btns"><button type="button" class="primary" data-clact="cutoff">Save</button></div></div>' +
    '<div class="toolbar-row"><button type="button" data-clact="lock">Lock manager area</button></div>';
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

function clEditPage(id) {
  const source = clState().templates.find(t => t.id === id && !t.deletedAt);
  if (!CL.unlocked || !source) return clManagePage();
  if (!CL.editDraft || CL.editDraft.id !== id) CL.editDraft = clone(source);
  const draft = CL.editDraft;
  footer('<button type="button" data-clact="edcancel">Cancel</button><button type="button" class="primary" data-clact="edsave">Save template</button>');
  return `${rcvBar('checklistsmanage', 'Edit template', `${CL_TYPE_NAMES[draft.type]} · v${source.version}`)}` +
    clField('clTplName', 'Template name', `<input id="clTplName" data-cled="name" value="${esc(draft.name)}" maxlength="${CL_LIMITS.name}" dir="auto">`) +
    clOrdered(draft).map(clEditSection).join('') + '<button type="button" class="ghost" data-clact="edaddsec">+ Add section</button>';
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
  if (!clStr(draft.name, CL_LIMITS.name)) return 'Give the template a name.';
  if (!draft.tasks.length) return 'Add at least one task.';
  if (draft.tasks.some(t => !clStr(t.label, CL_LIMITS.label))) return 'Every task needs a name.';
  if (draft.tasks.some(t => t.kind === 'number' && [t.min, t.max].some(v => v !== null && !Number.isFinite(v)))) return 'Min and max must be numbers.';
  return '';
}

function clEditSave() {
  const draft = CL.editDraft, list = clState().templates, index = list.findIndex(t => draft && t.id === draft.id);
  if (index < 0) return;
  const problem = clEditProblem(draft);
  if (problem) return notify(problem);
  const saved = clCleanTemplate({ ...draft, version: list[index].version + 1, updatedAt: clNow() });
  if (!saved) return notify('This template could not be saved.');
  list[index] = saved;
  CL.editDraft = null;
  if (!clSave()) return;
  notify(`Saved as v${saved.version}. Checklists already started keep their version.`);
  go('checklistsmanage');
}

function clEditStructure(ds) {
  const draft = CL.editDraft;
  if (!draft) return;
  const action = ds.clact, dir = Number(ds.dir);
  if (action === 'edaddsec') draft.sections.push({ id: clNewId(), name: 'New section', order: draft.sections.length });
  if (action === 'edaddtask') draft.tasks.push({ id: clNewId(), sectionId: ds.sec, label: 'New task', kind: 'check', unit: '', min: null, max: null, required: true, order: draft.tasks.length, link: '' });
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

function clTemplateAction(ds) {
  const settings = clState().settings, template = clTemplates().find(t => t.id === ds.tpl);
  if (!CL.unlocked || !template) return;
  if (ds.clact === 'tpldup') {
    if (clState().templates.filter(t => !t.deletedAt).length >= CL_LIMITS.templates) return notify('Delete a template before adding another.');
    const copy = clDuplicate(template, clNewId, clNow());
    clState().templates.push(copy);
    settings.active[copy.type] = copy.id;
    if (!clSave()) return;
    notify(`${copy.name} is now used for ${CL_TYPE_NAMES[copy.type]}.`);
    return go('checklistsedit/' + copy.id);
  }
  if (ds.clact === 'tpldel' && !confirm(`Delete ${template.name}? Past checklists keep their copy.`)) return;
  if (ds.clact === 'tpldel') template.deletedAt = clNow();
  if (ds.clact === 'tpluse') settings.active[template.type] = template.id;
  clState().settings = clCleanSettings(clState().settings, clState().templates);
  if (!clSave()) return;
  clRefresh();
}

function clSaveCutoff() {
  const value = $('clCutoff').value;
  if (!CL_CUTOFF_RE.test(value)) return notify('Pick a time such as 06:00.');
  clState().settings.dayCutoff = value;
  if (!clSave()) return;
  notify('Business day now starts at ' + value + '.');
  clRefresh();
}

Object.assign(CL_ACTIONS, {
  manage: clManageOpen, pinset: clPinSet, pincheck: clPinCheck, pinforgot: clPinForgot, pinreset: clPinReset,
  tpldup: clTemplateAction, tpluse: clTemplateAction, tpldel: clTemplateAction, cutoff: clSaveCutoff,
  edsave: clEditSave, edaddsec: clEditStructure, edaddtask: clEditStructure, eddeltask: clEditStructure,
  eddelsec: clEditStructure, edmove: clEditStructure,
  edcancel: () => {
    CL.editDraft = null;
    go('checklistsmanage');
  },
  lock: () => {
    CL.unlocked = false;
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

clInit();
