'use strict';
/* Checklists v1 — pages: Home card, hub, run screen, history. Every dynamic string goes through esc(). */
const clPlural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
const clDateText = iso => new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(iso + 'T00:00:00Z'));

function clBanner() {
  if (!CL.memoryOnly) return '';
  return '<p class="error" role="alert">Checklist history is not being saved on this device (browser storage is blocked). Keep the app open until you finish.</p>';
}

function clIssueList(issues, limit) {
  if (!issues.length) return '<p class="av-empty">No open issues.</p>';
  const rows = issues.slice(0, limit).map(({ run, task, entry }) => {
    const next = entry.nextAction ? ' · Next: ' + entry.nextAction : '';
    const meta = `${CL_TYPE_NAMES[run.type]} ${clDateText(run.businessDate)} · ${entry.byName}`;
    return `<div class="cl-issue"><div class="cl-issue-txt"><b>${esc(task.label)}</b><small>${esc(entry.note + next)}</small><small>${esc(meta)}</small></div>` +
      `<button type="button" data-clact="resolve" data-run="${esc(run.id)}" data-task="${esc(task.id)}">Resolve</button></div>`;
  }).join('');
  const more = issues.length > limit ? `<button type="button" class="ghost cl-more" data-go="checklists">All ${issues.length} open issues</button>` : '';
  return `<div class="cl-issues">${rows}${more}</div>`;
}

/* Opening first, then closing; null once both have been started today. */
function clSuggestedType() {
  if (!clTodayRun('opening')) return 'opening';
  if (!clTodayRun('closing')) return 'closing';
  return null;
}

function clHomeHeadline() {
  const open = clOpenRunsToday()[0];
  if (open) {
    const p = clRunProgress(open), next = p.next ? ' · next: ' + p.next.label : ' · ready to finish';
    return { title: `${CL_TYPE_NAMES[open.type]} ${p.done}/${p.total}${next}`, button: `<button class="primary" data-go="checklistsrun/${esc(open.id)}">Continue</button>` };
  }
  const type = clSuggestedType();
  if (!type) return { title: 'Checklists started today', button: '' };
  return { title: `Start ${type} checklist`, button: `<button class="primary" data-clact="start" data-type="${type}">Start</button>` };
}

function clHomeCard() {
  if (!CL.ready || !db.checklists) return '';
  const head = clHomeHeadline(), issues = clOpenIssues();
  const badge = issues.length ? `<span class="cl-badge">${clPlural(issues.length, 'open issue')}</span>` : '';
  return `<section class="home-task cl-home" aria-label="Checklists"><div class="cl-home-top"><h2>${esc(head.title)}</h2>${badge}</div>` +
    `<div class="home-task-btns"><button data-go="checklists">Checklists</button>${head.button || '<span></span>'}</div>` +
    (issues.length ? clIssueList(issues, 2) : '') + '</section>';
}

function clTypeStatus(type) {
  const run = clTodayRun(type), start = `<button type="button" class="primary" data-clact="start" data-type="${type}">Start</button>`;
  if (!run) return { status: 'Not started today', buttons: start };
  const p = clRunProgress(run), view = `<button type="button" data-go="checklistsrun/${esc(run.id)}">${run.completedAt ? 'View' : 'Continue'}</button>`;
  if (!run.completedAt) return { status: `In progress ${p.done}/${p.total} · ${run.staffName}`, buttons: view };
  const ack = run.type === 'handover' ? (run.ack ? ' · read by ' + run.ack.name : ' · not acknowledged') : '';
  return { status: `Finished ${stockTime(run.completedAt)} by ${run.staffName}${ack}`, buttons: view + start.replace('>Start<', '>Start again<') };
}

function clTypeCard(type) {
  const s = clTypeStatus(type), template = clActiveTemplate(type);
  return `<article class="cl-type"><div><b>${CL_TYPE_NAMES[type]}</b><small>${esc(s.status)}</small><small>${esc(template.name)} · v${template.version}</small></div>` +
    `<div class="cl-type-btns">${s.buttons}</div></article>`;
}

function clPendingAcks() {
  const from = clShiftDate(clToday(), -1);
  return CL.runs.filter(r => r.type === 'handover' && r.completedAt && !r.ack && r.businessDate >= from);
}

function clAckSection() {
  const list = clPendingAcks();
  if (!list.length) return '';
  return '<h2 class="home-h">Handover to read</h2>' + list.map(run => {
    const issues = clRunProgress(run).openIssues.length;
    const line = `By ${run.staffName} at ${stockTime(run.completedAt)}${issues ? ' · ' + clPlural(issues, 'open issue') : ''}`;
    return `<article class="cl-type cl-ack"><div><b>Handover</b><small>${esc(line)}</small></div><div class="cl-type-btns">` +
      `<button type="button" data-go="checklistsrun/${esc(run.id)}">Read</button><button type="button" class="primary" data-clact="ack" data-run="${esc(run.id)}">I've read this</button></div></article>`;
  }).join('');
}

function clHubPage() {
  const issues = clOpenIssues();
  return `${rcvBar('home', 'Checklists', 'Business day ' + clDateText(clToday()))}${clBanner()}` +
    `<div class="cl-types">${CL_TYPES.map(clTypeCard).join('')}</div>${clAckSection()}` +
    `<h2 class="home-h">Open issues${issues.length ? ' · ' + issues.length : ''}</h2>${clIssueList(issues, 50)}` +
    '<div class="toolbar-row"><button type="button" data-go="checklistshistory">History (30 days)</button><button type="button" data-clact="manage">Manage templates</button></div>';
}

function clRowDetail(task, st) {
  if (st && st.issue) return 'Issue: ' + st.issue.note + (st.issue.nextAction ? ' · Next: ' + st.issue.nextAction : '');
  if (task.kind !== 'number') return '';
  const value = st && st.last && st.last.value !== null && CL_HANDLED.includes(st.state) ? st.last.value : null;
  if (value !== null) return `Reading: ${value}${task.unit ? ' ' + task.unit : ''}`;
  const range = task.min !== null || task.max !== null ? ` (${task.min ?? '…'}–${task.max ?? '…'}${task.unit ? ' ' + task.unit : ''})` : '';
  return 'Tap to enter reading' + range;
}

function clRow(run, task, progress, live) {
  const st = progress.states.get(task.id), handled = !!st && CL_HANDLED.includes(st.state), issue = !!(st && st.issue);
  const cls = issue ? ' is-issue' : handled ? ' is-done' : '', detail = clRowDetail(task, st);
  const main = `<span class="cl-box" aria-hidden="true">${issue ? '!' : handled ? '✓' : ''}</span><span class="cl-label"><b>${esc(task.label)}</b>` +
    `${detail ? `<small>${esc(detail)}</small>` : ''}${task.required ? '' : '<small class="cl-opt">Optional</small>'}</span>`;
  if (!live) return `<div class="cl-row${cls}"><div class="cl-main">${main}</div></div>`;
  const ids = `data-run="${esc(run.id)}" data-task="${esc(task.id)}"`;
  const link = task.link ? `<button type="button" class="cl-link" data-clact="link" data-link="${task.link}">${CL_LINKS[task.link]}</button>` : '';
  return `<div class="cl-row${cls}"><button type="button" class="cl-main" data-clact="tap" ${ids} aria-pressed="${handled}">${main}</button>${link}` +
    `<button type="button" class="cl-flag" data-clact="issue" ${ids} aria-label="Report an issue: ${esc(task.label)}">!</button></div>`;
}

function clSection(run, group, progress, live) {
  const key = run.id + ':' + group.section.id, done = group.tasks.filter(t => CL_HANDLED.includes(progress.states.get(t.id)?.state)).length;
  return `<details class="cl-sec" data-clsec="${esc(key)}"${CL.collapsed.has(key) ? '' : ' open'}><summary><b>${esc(group.section.name)}</b><span>${done}/${group.tasks.length}</span></summary>` +
    group.tasks.map(t => clRow(run, t, progress, live)).join('') + '</details>';
}

function clRunStatus(run, progress) {
  if (!run.completedAt) return '';
  const ack = run.type !== 'handover' ? '' : run.ack ? ` · Read by ${run.ack.name} at ${stockTime(run.ack.at)}` : ' · Not acknowledged yet';
  const button = run.type === 'handover' && !run.ack ? `<button type="button" class="primary" data-clact="ack" data-run="${esc(run.id)}">I've read this</button>` : '';
  const issues = progress.openIssues.length ? ` · ${clPlural(progress.openIssues.length, 'open issue')}` : '';
  return `<div class="cl-status"><p>${esc(`Finished ${stockDateTime(new Date(run.completedAt))}${issues}${ack}`)}</p>${button}</div>`;
}

function clRunPage(id) {
  const run = clRunById(id);
  if (!run) return `${rcvBar('checklists', 'Checklist', '')}<div class="empty"><p>This checklist is not on this device.</p></div>`;
  const p = clRunProgress(run), live = !run.completedAt;
  if (live) footer(`<button type="button" class="primary" data-clact="finish" data-run="${esc(run.id)}">Finish</button>`);
  const sub = `${run.staffName} · ${clDateText(run.businessDate)} · ${p.done}/${p.total}`;
  const bar = `<div class="cl-bar" role="progressbar" aria-label="Progress" aria-valuemin="0" aria-valuemax="${p.total}" aria-valuenow="${p.done}"><span style="width:${p.total ? Math.round(p.done / p.total * 100) : 0}%"></span></div>`;
  const next = live && p.next ? `<div class="cl-next"><small>Next task</small>${clRow(run, p.next, p, live)}</div>` : '';
  return `${rcvBar('checklists', `${CL_TYPE_NAMES[run.type]} checklist`, sub)}${clBanner()}${bar}${clRunStatus(run, p)}${next}` +
    p.groups.map(g => clSection(run, g, p, live)).join('');
}

function clHistoryRow(run) {
  const p = clRunProgress(run), issues = p.openIssues.length ? ' · ' + clPlural(p.openIssues.length, 'open issue') : '';
  const state = run.completedAt ? 'Finished ' + stockTime(run.completedAt) : 'Not finished';
  const ack = run.type === 'handover' && run.ack ? ' · read by ' + run.ack.name : '';
  return `<button type="button" class="cl-hist" data-go="checklistsrun/${esc(run.id)}"><b>${CL_TYPE_NAMES[run.type]}</b>` +
    `<small>${esc(`${run.staffName} · ${p.done}/${p.total} · ${state}${issues}${ack}`)}</small></button>`;
}

function clHistoryPage() {
  const from = clShiftDate(clToday(), -CL_HISTORY_DAYS);
  const runs = CL.runs.filter(r => r.businessDate >= from)
    .sort((a, b) => (a.businessDate === b.businessDate ? (a.startedAt < b.startedAt ? 1 : -1) : a.businessDate < b.businessDate ? 1 : -1));
  if (!runs.length) return `${rcvBar('checklists', 'Checklist history', 'Last 30 days')}<div class="empty"><p>No checklists in the last 30 days.</p></div>`;
  let html = '', date = '';
  for (const run of runs) {
    if (run.businessDate !== date) {
      date = run.businessDate;
      html += `<h2 class="home-h cl-date">${clDateText(date)}</h2>`;
    }
    html += clHistoryRow(run);
  }
  return `${rcvBar('checklists', 'Checklist history', 'Last 30 days')}${clBanner()}<div class="cl-hist-list">${html}</div>`;
}

function clRender(page, id) {
  if (!CL.ready) return '<div class="empty"><p>Loading checklists…</p></div>';
  if (page === 'checklistsrun') return clRunPage(id);
  if (page === 'checklistshistory') return clHistoryPage();
  if (page === 'checklistsmanage') return clManagePage();
  if (page === 'checklistsedit') return clEditPage(id);
  return clHubPage();
}

function clRefresh() {
  const y = window.scrollY;
  render();
  window.scrollTo(0, y);
}
