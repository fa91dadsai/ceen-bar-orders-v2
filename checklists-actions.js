'use strict';
/* Checklists v1 — dialogs and tap actions for staff (start, tick, issue, reading, stock follow-up, finish, ack). */
const CL_LINK_ROUTES = { stock85: 'stock', order: 'review', receive: 'orders', recipes: 'recipes' };

function clDialog(title, body, foot) {
  let dialog = $('clDialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'clDialog';
    dialog.setAttribute('aria-labelledby', 'clDialogTitle');
    dialog.addEventListener('click', e => {
      if (e.target === dialog) closeDialog(dialog);
    });
    document.body.appendChild(dialog);
  }
  dialog.innerHTML = `<div class="dialog-head"><h2 id="clDialogTitle">${esc(title)}</h2><button type="button" data-close="clDialog" aria-label="Close">×</button></div>` +
    `<div class="dialog-body">${body}<p class="error" id="clErr" role="alert" hidden></p></div><div class="dialog-foot">${foot}</div>`;
  if (!dialog.open) showDialog(dialog);
  const first = dialog.querySelector('input,textarea');
  if (first) first.focus();
}

function clCloseDialog() {
  const dialog = $('clDialog');
  if (dialog && dialog.open) closeDialog(dialog);
}

function clError(message) {
  const box = $('clErr');
  if (!box) return;
  box.textContent = message;
  box.hidden = false;
}

const clField = (id, label, input) => `<div class="field"><label for="${id}">${label}</label>${input}</div>`;
const clCancel = '<button type="button" data-close="clDialog">Cancel</button>';

function clKnownStaff() {
  const names = [cleanName(db.preferences.preparerName), ...[...CL.runs].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)).map(r => r.staffName)];
  return [...new Set(names.filter(Boolean))].slice(0, 6);
}

function clNameDialog(type) {
  const preset = clState().settings.lastStaff || cleanName(db.preferences.preparerName);
  const chips = clKnownStaff().map(n => `<button type="button" class="tf-chip" data-clact="staffpick" data-name="${esc(n)}">${esc(n)}</button>`).join('');
  clDialog(`Start ${type} checklist`,
    clField('clStaff', 'Your name', `<input id="clStaff" maxlength="40" autocomplete="off" dir="auto" value="${esc(preset)}">`) + (chips ? `<div class="cl-chips">${chips}</div>` : ''),
    `${clCancel}<button type="button" class="primary" data-clact="startgo" data-type="${type}">Start</button>`);
}

function clIssueDialog(run, task) {
  const open = clRunProgress(run).states.get(task.id)?.issue;
  clDialog('Report an issue', `<p><b>${esc(task.label)}</b></p>` +
    clField('clNote', 'What is wrong? *', `<textarea id="clNote" maxlength="${CL_LIMITS.note}" rows="3" dir="auto">${esc(open ? open.note : '')}</textarea>`) +
    clField('clNext', 'Next action (optional)', `<input id="clNext" maxlength="${CL_LIMITS.nextAction}" dir="auto" value="${esc(open ? open.nextAction : '')}">`),
    `${clCancel}<button type="button" class="primary" data-clact="issuesave" data-run="${esc(run.id)}" data-task="${esc(task.id)}">Save issue</button>`);
}

function clIssueView(run, task, issue) {
  const ids = `data-run="${esc(run.id)}" data-task="${esc(task.id)}"`;
  clDialog('Open issue', `<p><b>${esc(task.label)}</b></p><p>${esc(issue.note)}</p>` +
    (issue.nextAction ? `<p class="hint">Next: ${esc(issue.nextAction)}</p>` : '') + `<p class="hint">${esc(issue.byName)} · ${esc(stockTime(issue.at))}</p>`,
    `<button type="button" data-clact="issue" ${ids}>Edit issue</button><button type="button" class="primary" data-clact="resolve" ${ids}>Resolve</button>`);
}

function clNumberDialog(run, task) {
  const st = clRunProgress(run).states.get(task.id), last = st && st.last && st.last.value !== null ? st.last.value : '';
  const range = task.min !== null || task.max !== null ? `<p class="hint">Allowed: ${task.min ?? '…'}–${task.max ?? '…'} ${esc(task.unit)}</p>` : '';
  const ids = `data-run="${esc(run.id)}" data-task="${esc(task.id)}"`;
  const clear = st && CL_HANDLED.includes(st.state) ? `<button type="button" data-clact="numclear" ${ids}>Clear</button>` : clCancel;
  clDialog(task.label, clField('clNum', 'Reading' + (task.unit ? ' (' + esc(task.unit) + ')' : ''),
    `<input id="clNum" inputmode="decimal" autocomplete="off" value="${esc(last)}">`) + range,
    `${clear}<button type="button" class="primary" data-clact="numsave" ${ids}>Save reading</button>`);
}

function clFinishDialog(run) {
  const p = clRunProgress(run), list = items => `<ul class="cl-list">${items.join('')}</ul>`;
  let body = '';
  if (p.requiredLeft.length) {
    body += `<p><b>${clPlural(p.requiredLeft.length, 'required task')} not done</b></p>${list(p.requiredLeft.map(t => `<li>${esc(t.label)}</li>`))}<p class="hint">Tick them, or report an issue, before finishing.</p>`;
  }
  if (p.openIssues.length) {
    body += `<p><b>${clPlural(p.openIssues.length, 'open issue')}</b> will stay visible to the next shift.</p>${list(p.openIssues.map(i => `<li>${esc(i.task.label + ': ' + i.entry.note)}</li>`))}`;
  }
  const finish = p.requiredLeft.length ? '' : `<button type="button" class="primary" data-clact="finishgo" data-run="${esc(run.id)}">${p.openIssues.length ? 'Finish with open issues' : 'Finish'}</button>`;
  clDialog('Finish checklist', body || '<p>Every task is done.</p>', `<button type="button" data-close="clDialog">Keep working</button>${finish}`);
}

function clAckDialog(run) {
  clDialog('Read the handover', `<p class="hint">Confirms you, the incoming staff, have read this handover.</p>` +
    clField('clAckName', 'Your name', `<input id="clAckName" maxlength="40" autocomplete="off" dir="auto" value="${esc(cleanName(db.preferences.preparerName))}">`),
    `${clCancel}<button type="button" class="primary" data-clact="ackgo" data-run="${esc(run.id)}">I've read this</button>`);
}

function clStockResults() {
  const query = norm(($('clItemQ') && $('clItemQ').value) || '');
  if (!query) return '<p class="av-empty">Type an item name.</p>';
  const hits = ITEMS.filter(i => norm(i.name).includes(query)).slice(0, 8);
  if (!hits.length) return '<p class="av-empty">No matching item.</p>';
  return hits.map(i => `<button type="button" class="cl-pick" data-clact="pickitem" data-item="${esc(i.id)}"><b>${esc(i.name)}</b><small>${esc(cat(i.cat) ? cat(i.cat).name : '')}</small></button>`).join('');
}

function clStockItem(item) {
  const run = clRunById(CL.stock.runId), added = run && run.orderAdds[CL.stock.taskId], av = db.availability[item.id], qty = line(item.id).qty;
  const now = av ? (av.status === '86' ? '86 Out' : '85 Low') : 'In stock';
  const add = added
    ? `<p class="hint">Already added ${esc(added.qty)} to the order draft for this task.</p>`
    : `<div class="cl-addrow"><input id="clAddQty" inputmode="decimal" value="1" aria-label="Quantity to add"><button type="button" class="primary" data-clact="addorder">Add to order draft</button></div>`;
  return `<div class="cl-stock"><b>${esc(item.name)}</b><small>${esc(`Now: ${now} · In order draft: ${qty} ${unitText(qty, item.unit)}`)}</small>` +
    `<div class="cl-type-btns"><button type="button" data-clact="mark" data-st="85">Mark 85</button><button type="button" data-clact="mark" data-st="86">Mark 86</button></div>` +
    `${add}<button type="button" class="ghost" data-clact="pickclear">Pick another item</button></div>`;
}

function clStockBody() {
  const item = CL.stock && CL.stock.itemId && byId[CL.stock.itemId];
  return item ? clStockItem(item) : clStockResults();
}

function clStockRefresh() {
  const box = $('clItemBox');
  if (box) box.innerHTML = clStockBody();
}

function clStockDialog(run, task) {
  CL.stock = { runId: run.id, taskId: task.id, itemId: null };
  clDialog('Stock follow-up', `<p class="hint">${esc(task.label)}: mark the item 85/86 or add it to the order draft. Nothing is marked received.</p>` +
    clField('clItemQ', 'Item', '<input id="clItemQ" type="search" autocomplete="off" placeholder="Search items">') + `<div id="clItemBox">${clStockBody()}</div>`,
    '<button type="button" class="primary" data-close="clDialog">Done</button>');
}

function clAddToDraft() {
  const s = CL.stock, run = s && clRunById(s.runId), item = s && byId[s.itemId];
  if (!run || !item) return;
  if (run.orderAdds[s.taskId]) {
    notify('Already added to the order draft for this task.');
    return;
  }
  const qty = parseQty($('clAddQty').value, item.unit);
  if (qty === null || qty <= 0) {
    clError(qtyRule(item.unit));
    return;
  }
  /* Same line shape as carryIntoDraft: validateOrder rejects a line without `unit`. */
  const current = db.order.lines[item.id] || { qty: 0, note: '', stock: '' };
  db.order.lines[item.id] = { ...current, unit: item.unit, qty: Math.min(QTY_MAX, r2(current.qty + qty)) };
  db.order.visited[item.id] = true;
  if (db.order.skipped) delete db.order.skipped[item.id];
  save();
  run.orderAdds[s.taskId] = { itemId: item.id, qty, at: clNow() };
  clPutRun(run);
  notify(`Added ${qty} ${unitText(qty, item.unit)} of ${item.name} to the order draft.`);
  clStockRefresh();
}

function clTarget(ds) {
  const run = clRunById(ds.run), task = run && run.snapshot.tasks.find(t => t.id === ds.task);
  return run && task ? { run, task } : null;
}

function clTap(ds) {
  const target = clTarget(ds);
  if (!target || target.run.completedAt) return;
  const { run, task } = target, st = clRunProgress(run).states.get(task.id);
  if (st && st.issue) return clIssueView(run, task, st.issue);
  if (task.kind === 'number') return clNumberDialog(run, task);
  const handled = st && CL_HANDLED.includes(st.state);
  clAddEntry(run, task.id, { state: handled ? 'undone' : 'done' });
  if (!handled) clVibrate();
  clRefresh();
}

function clSaveIssue(ds) {
  const target = clTarget(ds), note = clStr($('clNote').value, CL_LIMITS.note);
  if (!target) return;
  if (!note) return clError('Describe the issue.');
  clAddEntry(target.run, target.task.id, { state: 'issue', note, nextAction: clStr($('clNext').value, CL_LIMITS.nextAction) });
  clCloseDialog();
  clRefresh();
  if (target.task.link === 'stock85') clStockDialog(target.run, target.task);
}

function clSaveNumber(ds) {
  const target = clTarget(ds), raw = $('clNum').value.trim().replace(',', '.');
  if (!target) return;
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return clError('Enter a number, for example 4 or 3.5.');
  const value = Number(raw), problem = clRangeProblem(target.task, value);
  clAddEntry(target.run, target.task.id, problem ? { state: 'issue', value, note: problem } : { state: 'done', value });
  clCloseDialog();
  if (problem) notify('Out of range — saved as an issue.');
  else clVibrate();
  clRefresh();
}

function clResolve(ds) {
  const target = clTarget(ds);
  if (!target) return;
  clAddEntry(target.run, target.task.id, { state: 'resolved' });
  clVibrate();
  clCloseDialog();
  notify('Issue resolved.');
  clRefresh();
}

function clStart(ds) {
  const open = clOpenRunsToday().find(r => r.type === ds.type);
  if (open) return go('checklistsrun/' + open.id);
  clNameDialog(ds.type);
}

function clStartGo(ds) {
  const name = cleanName($('clStaff').value);
  if (!name) return clError('Enter your name.');
  const run = clStartRun(ds.type, name);
  clCloseDialog();
  go('checklistsrun/' + run.id);
}

function clRunUpdate(ds, change, message) {
  const run = clRunById(ds.run);
  if (!run) return;
  change(run);
  clPutRun(run);
  clCloseDialog();
  notify(message);
}

function clFinishGo(ds) {
  clRunUpdate(ds, run => {
    run.completedAt = clNow();
  }, 'Checklist finished.');
  go('checklists');
}

function clAckGo(ds) {
  const name = cleanName($('clAckName').value);
  if (!name) return clError('Enter your name.');
  clRunUpdate(ds, run => {
    run.ack = { name, at: clNow() };
  }, 'Handover acknowledged.');
  clRefresh();
}

function clNumberClear(ds) {
  const target = clTarget(ds);
  if (target) clAddEntry(target.run, target.task.id, { state: 'undone' });
  clCloseDialog();
  clRefresh();
}

function clOpenIssueDialog(ds) {
  const target = clTarget(ds);
  if (target && !target.run.completedAt) clIssueDialog(target.run, target.task);
}

function clWithRun(show) {
  return ds => {
    const run = clRunById(ds.run);
    if (run) show(run);
  };
}

function clMark(ds) {
  const id = CL.stock && CL.stock.itemId;
  if (!byId[id]) return;
  avApply(id, ds.st, null);
  notify(avMsg(id, ds.st));
  clStockRefresh();
}

function clPickItem(itemId) {
  CL.stock.itemId = itemId;
  clStockRefresh();
}

const CL_ACTIONS = {
  start: clStart, startgo: clStartGo, tap: clTap, resolve: clResolve, issuesave: clSaveIssue, numsave: clSaveNumber,
  issue: clOpenIssueDialog, numclear: clNumberClear, finishgo: clFinishGo, ackgo: clAckGo,
  finish: clWithRun(clFinishDialog), ack: clWithRun(clAckDialog),
  staffpick: ds => {
    $('clStaff').value = ds.name;
  },
  link: ds => go(CL_LINK_ROUTES[ds.link] || 'home'),
  pickitem: ds => clPickItem(ds.item),
  pickclear: () => clPickItem(null),
  mark: clMark,
  addorder: clAddToDraft
};

document.addEventListener('click', e => {
  const button = e.target.closest && e.target.closest('[data-clact]');
  if (!button || button.disabled) return;
  const action = CL_ACTIONS[button.dataset.clact];
  if (action) action(button.dataset, button);
});

document.addEventListener('input', e => {
  if (e.target.id === 'clItemQ') clStockRefresh();
});

document.addEventListener('keydown', e => {
  const dialog = $('clDialog');
  if (e.key !== 'Enter' || !dialog || !dialog.contains(e.target) || e.target.tagName !== 'INPUT') return;
  const primary = dialog.querySelector('.dialog-foot .primary[data-clact]');
  if (primary) {
    e.preventDefault();
    primary.click();
  }
});

/* <details> toggle does not bubble, so listen in the capture phase to remember collapsed sections. */
document.addEventListener('toggle', e => {
  const key = e.target && e.target.dataset && e.target.dataset.clsec;
  if (!key) return;
  if (e.target.open) CL.collapsed.delete(key);
  else CL.collapsed.add(key);
}, true);
