import { dateKey, parseDate, addDays, mondayOf, isoWeek, monthGrid } from './dates.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const today = dateKey(new Date());
const todayDate = parseDate(today);
const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const backgrounds = [
  { id: 'mist', name: '山间晨雾' },
  { id: 'dusk', name: '暮色云海' },
  { id: 'sage', name: '薄荷微光' },
  { id: 'paper', name: '奶油纸笺' },
];
const defaults = { background: 'mist', customBackground: null, fontSize: 15, textColor: '#444c45', headingColor: '#253b2d', entryColor: '#444c45', todoColor: '#444c45' };
const state = {
  week: mondayOf(today), monthYear: todayDate.getFullYear(), monthIndex: todayDate.getMonth(),
  entries: [], todos: [], calendar: [], summary: '', summaryDirty: false,
  settings: { ...defaults }, draftSettings: null, selectedDay: null, tab: 'records', view: 'weeks',
  todoFilter: 'pending', wideFilter: 'pending', editEntry: null, editTodo: null, deleteAction: null,
};
let toastTimer, summaryTimer, pendingSave = Promise.resolve(), savingCount = 0, navigationVersion = 0, requestedWeek = state.week;
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const shortDate = key => `${Number(key.slice(5, 7))}月${Number(key.slice(8))}日`;
const isOverdue = todo => !todo.completed && todo.due && new Date(todo.due) < new Date();
const backgroundUrl = settings => settings.background === 'custom' ? settings.customBackground : `/backgrounds/${settings.background}.svg`;

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && typeof options.body !== 'string' && !(options.body instanceof Blob)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }
  let response;
  try { response = await fetch(path, { ...options, headers }); }
  catch { throw new Error('连接失败，请检查服务是否正在运行'); }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '操作失败，请重试');
  return result;
}
function toast(message, error = false) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').className = `toast visible${error ? ' error' : ''}`;
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3200);
}
function on(target, event, handler) {
  $(target).addEventListener(event, async e => {
    try { await handler(e); } catch (error) { toast(error.message, true); }
  });
}
function applyAppearance(settings) {
  const style = document.documentElement.style;
  for (const [key, variable] of Object.entries({ textColor: '--text', headingColor: '--heading', entryColor: '--entry-text', todoColor: '--todo-text' })) style.setProperty(variable, settings[key]);
  style.setProperty('--font-size', `${settings.fontSize}px`);
  style.setProperty('--background-image', `url("${backgroundUrl(settings)}")`);
}
function renderCalendar() {
  $('#month-picker-button').textContent = `${state.monthYear} 年 ${state.monthIndex + 1} 月`;
  $('#month-picker').value = `${state.monthYear}-${String(state.monthIndex + 1).padStart(2, '0')}`;
  const recordedWeeks = new Set(state.calendar.map(item => item.week));
  $('#calendar-grid').innerHTML = monthGrid(state.monthYear, state.monthIndex).map((key, index) => {
    const selected = mondayOf(key) === state.week;
    const classes = ['calendar-day', parseDate(key).getMonth() !== state.monthIndex ? 'outside' : '', selected ? 'selected' : '', index % 7 === 0 ? 'week-start' : '', index % 7 === 6 ? 'week-end' : '', key === today ? 'today' : '', recordedWeeks.has(mondayOf(key)) ? 'has-record' : ''].filter(Boolean).join(' ');
    return `<button class="${classes}" data-calendar-date="${key}" aria-label="${key}${key === today ? '，今天' : ''}" aria-pressed="${selected}"><span>${Number(key.slice(8))}</span></button>`;
  }).join('');
  const info = isoWeek(state.week);
  const count = isoWeek(`${info.year}-12-28`).week;
  $('#year-progress-label').textContent = `${info.year} 年`;
  $('#year-progress-count').textContent = `第 ${info.week} 周 / 共 ${count} 周`;
  $('#year-progress').style.width = `${info.week / count * 100}%`;
}
function renderWeekHeader() {
  const info = isoWeek(state.week);
  const end = addDays(state.week, 6);
  $('#hero-week').textContent = `${info.year} · WEEK ${String(info.week).padStart(2, '0')}`;
  $('#hero-dates').textContent = `${shortDate(state.week)} — ${shortDate(end)}`;
  $('#hero-record-count').textContent = `${state.entries.length} 条记录`;
  const startYear = state.week.slice(0, 4), endYear = end.slice(0, 4);
  $('#hero-month').textContent = startYear === endYear ? `${startYear} 年` : `${startYear} — ${endYear}`;
  $('#current-week-badge').hidden = state.week !== mondayOf(today);
  $('#record-tab-count').textContent = state.entries.length;
  const days = new Set(state.entries.filter(entry => entry.date).map(entry => entry.date));
  $('#week-footprint').textContent = `${days.size} 天 · ${state.entries.length} 条记录`;
  $('#footprint-dots').innerHTML = Array.from({ length: 7 }, (_, i) => `<span class="${days.has(addDays(state.week, i)) ? 'filled' : ''}" title="${weekdays[i]}"></span>`).join('');
  $('#journal-footer-label').textContent = `${info.year} 年 · 第 ${info.week} 周`;
  $('#week-days').innerHTML = Array.from({ length: 7 }, (_, i) => {
    const key = addDays(state.week, i);
    return `<button class="week-day${key === today ? ' today' : ''}${key === state.selectedDay ? ' chosen' : ''}" data-day="${key}" aria-label="${key} ${weekdays[i]}" aria-pressed="${key === state.selectedDay}"><span>${weekdays[i]}${key === today ? ' · 今' : ''}</span><strong>${Number(key.slice(8))}</strong>${days.has(key) ? '<i class="day-dot"></i>' : ''}</button>`;
  }).join('');
}
const notebook = `<svg class="journal-illustration" viewBox="0 0 160 140" fill="none" aria-hidden="true"><ellipse cx="83" cy="124" rx="48" ry="7" fill="#e9eddf"/><path d="M112 111c8-22 14-32 27-34-1 11-7 21-27 34Z" fill="#d4dfc3"/><path d="M117 108c-5-17-3-27 2-32 7 9 8 19-2 32Z" fill="#e1e8d5"/><rect x="36" y="22" width="71" height="93" rx="7" transform="rotate(-7 36 22)" fill="#f9fbf3" stroke="#c2cfb0" stroke-width="1.4"/><path d="m48 31 8 77" stroke="#e3e9d7"/><path d="m65 45 27-3m-25 14 30-3m-29 14 23-2m-22 13 29-3m-27 14 18-2" stroke="#d7e0c8" stroke-width="2.1" stroke-linecap="round"/><g stroke="#9eaf8a" stroke-width="1.8" stroke-linecap="round"><path d="m33 37 9-1m-8 15 9-1m-7 15 8-1m-7 15 9-1m-7 15 9-1"/></g><path d="m99 97 23-54 7 3-23 54-8 8Z" fill="#a5b48d"/><path d="m122 43 2-5c1-3 3-3 5-2s3 2 2 5l-2 5" fill="#c5d0b5"/><path d="m99 98-1 10 8-8" fill="#dfd8bc"/><path d="m98 105 0 3 3-2" fill="#8e9b7b"/><path d="m28 99-4 4m1-15-5-1m107-69 4-5m5 16 6-1" stroke="#c7d4b6" stroke-width="1.6" stroke-linecap="round"/></svg>`;
function recordMarkup(entry) {
  const style = `${entry.color ? `color:${entry.color};` : ''}${entry.font_size ? `font-size:${entry.font_size}px;` : ''}`;
  const time = new Date(entry.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `<article class="record-card"><span class="record-bullet"></span><div class="record-body"><p class="record-content" style="${style}">${escape(entry.content)}</p><div class="record-timestamp">${escape(time)}</div></div><div class="record-actions"><button class="icon-button" data-edit-entry="${entry.id}" aria-label="编辑记录" title="编辑">${icon('edit')}</button><button class="icon-button delete-button" data-delete-entry="${entry.id}" aria-label="删除记录" title="删除">${icon('trash')}</button></div></article>`;
}
function renderRecords() {
  const search = $('#record-search').value.trim().toLocaleLowerCase();
  const filtered = state.entries.filter(entry => (!state.selectedDay || entry.date === state.selectedDay) && (!search || entry.content.toLocaleLowerCase().includes(search)));
  $('#filter-date-label').textContent = state.selectedDay ? `${shortDate(state.selectedDay)} · ${filtered.length} 条` : `${filtered.length} 条记录`;
  if (!filtered.length) {
    const label = search ? '没有匹配的记录' : state.selectedDay ? '这一天暂无记录' : '本周暂无记录';
    $('#records-list').innerHTML = `<div class="empty-records">${notebook}<h3>${label}</h3>${!search ? `<button class="quiet-button" data-empty-add>${icon('plus')}记下第一笔</button>` : ''}</div>`;
    return;
  }
  const groups = new Map();
  for (const entry of filtered) {
    const key = entry.date || 'undated';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  $('#records-list').innerHTML = [...groups].map(([key, entries]) => {
    const i = key === 'undated' ? null : (parseDate(key).getDay() + 6) % 7;
    return `<section class="record-group"><div class="record-group-heading"><span>${key === 'undated' ? '未指定日期' : weekdays[i]}</span>${key === 'undated' ? '' : `<span>${shortDate(key)}</span>`}<span class="group-line"></span><span>${entries.length}</span></div>${entries.map(recordMarkup).join('')}</section>`;
  }).join('');
}
function dueLabel(value) {
  const key = value.slice(0, 10);
  const prefix = key === today ? '今天' : key === addDays(today, 1) ? '明天' : `${key.slice(0, 4) !== today.slice(0, 4) ? `${key.slice(0, 4)}年` : ''}${shortDate(key)}`;
  return `${prefix} ${value.slice(11, 16)}`;
}
function todoMarkup(todo) {
  const style = `${todo.color ? `color:${todo.color};` : ''}${todo.font_size ? `font-size:${todo.font_size}px;` : ''}`;
  const overdue = isOverdue(todo);
  return `<article class="todo-item${todo.completed ? ' completed' : ''}"><button class="todo-check" data-toggle-todo="${todo.id}" role="checkbox" aria-checked="${Boolean(todo.completed)}" aria-label="${todo.completed ? '恢复待办' : '完成待办'}：${escape(todo.content.slice(0, 80))}">${todo.completed ? icon('check') : ''}</button><div class="todo-body"><p class="todo-content" style="${style}">${escape(todo.content)}</p>${todo.due ? `<div class="todo-due${overdue ? ' overdue' : ''}">${icon('clock')}<time datetime="${todo.due}">${dueLabel(todo.due)}</time>${overdue ? '<span class="due-badge">逾期</span>' : ''}</div>` : ''}</div><div class="record-actions"><button class="icon-button" data-edit-todo="${todo.id}" aria-label="编辑待办" title="编辑">${icon('edit')}</button><button class="icon-button delete-button" data-delete-todo="${todo.id}" aria-label="删除待办" title="删除">${icon('trash')}</button></div></article>`;
}
function emptyTodos(label) {
  return `<div class="empty-todos"><div class="todo-empty-icon">${icon('check-square')}</div><span>${label}</span></div>`;
}
function renderTodos() {
  const pending = state.todos.filter(todo => !todo.completed);
  const completed = state.todos.filter(todo => todo.completed);
  $('#nav-todo-count').textContent = pending.length;
  $('#pending-count').textContent = pending.length;
  $('#completed-count').textContent = completed.length;
  $('#todo-progress-label').textContent = `${completed.length} / ${state.todos.length}`;
  $('#todo-progress-bar').style.width = `${state.todos.length ? completed.length / state.todos.length * 100 : 0}%`;
  const railTodos = state.todoFilter === 'pending' ? pending : completed;
  $('#todo-list').innerHTML = railTodos.length ? railTodos.map(todoMarkup).join('') : emptyTodos(state.todoFilter === 'pending' ? '暂无待办，片刻轻盈。' : '暂无已完成事项');
  $$('[data-todo-filter]').forEach(button => button.classList.toggle('active', button.dataset.todoFilter === state.todoFilter));
  const search = $('#todo-search').value.trim().toLocaleLowerCase();
  const wide = (state.wideFilter === 'pending' ? pending : state.wideFilter === 'completed' ? completed : state.todos).filter(todo => !search || todo.content.toLocaleLowerCase().includes(search));
  $('#wide-todo-list').innerHTML = wide.length ? wide.map(todoMarkup).join('') : emptyTodos(search ? '没有匹配的待办' : '暂无事项');
  $$('[data-wide-filter]').forEach(button => button.classList.toggle('active', button.dataset.wideFilter === state.wideFilter));
  $('#todo-stats').innerHTML = `<div class="stat-card"><div><span>待完成</span><strong>${pending.length}</strong></div>${icon('check-square')}</div><div class="stat-card"><div><span>已完成</span><strong>${completed.length}</strong></div>${icon('check')}</div><div class="stat-card overdue"><div><span>已逾期</span><strong>${pending.filter(isOverdue).length}</strong></div>${icon('clock')}</div>`;
}
function renderView() {
  const weeks = state.view === 'weeks';
  $('#week-view').hidden = !weeks;
  $('#week-hero').hidden = !weeks;
  $('#todos-view').hidden = weeks;
  $('#export-button').hidden = !weeks;
  $('#page-title').textContent = weeks ? '我的周报' : '全部待办';
  document.title = `拾周 · ${weeks ? '我的周报' : '全部待办'}`;
  $$('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === state.view));
}
function renderTab() {
  const records = state.tab === 'records';
  $('#records-panel').hidden = !records;
  $('#summary-panel').hidden = records;
  for (const [selector, active] of [['#records-tab', records], ['#summary-tab', !records]]) {
    $(selector).classList.toggle('active', active);
    $(selector).setAttribute('aria-selected', active);
  }
}
function renderWeek() { renderCalendar(); renderWeekHeader(); renderRecords(); }
async function refreshEntries() {
  [state.entries, state.calendar] = await Promise.all([api(`/api/entries?week=${state.week}`), api('/api/calendar')]);
  renderWeek();
}
async function refreshTodos() { state.todos = await api('/api/todos'); renderTodos(); }
function updateSummaryStatus(label) { $('#summary-status').textContent = label; }
function saveSummary() {
  clearTimeout(summaryTimer);
  if (!state.summaryDirty) return pendingSave;
  const week = state.week, summary = state.summary;
  state.summaryDirty = false;
  savingCount++;
  updateSummaryStatus('保存中…');
  pendingSave = pendingSave.catch(() => {}).then(() => api(`/api/weeks/${week}`, { method: 'PUT', body: { summary } })).then(() => {
    if (state.week === week && state.summary === summary && !state.summaryDirty) updateSummaryStatus('已保存');
  }).catch(error => {
    if (state.week === week) { state.summaryDirty = true; updateSummaryStatus('保存失败'); }
    throw error;
  }).finally(() => { savingCount--; });
  return pendingSave;
}
async function navigateWeek(week, syncMonth = true) {
  const version = ++navigationVersion;
  requestedWeek = week;
  $('#week-summary').readOnly = true;
  let entries, note;
  try {
    await saveSummary();
    [entries, note] = await Promise.all([api(`/api/entries?week=${week}`), api(`/api/weeks/${week}`)]);
  } catch (error) {
    if (version === navigationVersion) { requestedWeek = state.week; $('#week-summary').readOnly = false; }
    throw error;
  }
  if (version !== navigationVersion) return;
  $('#week-summary').readOnly = false;
  state.week = week; state.entries = entries; state.summary = note.summary;
  state.summaryDirty = false; state.selectedDay = null;
  $('#record-search').value = '';
  $('#week-summary').value = state.summary;
  $('#summary-length').textContent = `${state.summary.length} 字`;
  updateSummaryStatus('已保存');
  if (syncMonth) { const date = parseDate(week); state.monthYear = date.getFullYear(); state.monthIndex = date.getMonth(); }
  state.view = 'weeks'; renderView(); renderWeek();
}
function moveMonth(delta) {
  const date = new Date(state.monthYear, state.monthIndex + delta, 1, 12);
  state.monthYear = date.getFullYear(); state.monthIndex = date.getMonth(); renderCalendar();
}
function openEntry(id = null) {
  state.editEntry = id;
  const entry = state.entries.find(item => item.id === id);
  $('#entry-dialog-title').textContent = entry ? '编辑记录' : '记一笔';
  $('#entry-date').innerHTML = '<option value="">不指定日期</option>' + Array.from({ length: 7 }, (_, i) => {
    const key = addDays(state.week, i);
    return `<option value="${key}">${shortDate(key)} · ${weekdays[i]}</option>`;
  }).join('');
  $('#entry-date').value = entry ? entry.date || '' : state.selectedDay || '';
  $('#entry-content').value = entry?.content || '';
  $('#entry-color').value = entry?.color || state.settings.entryColor;
  $('#entry-inherit-color').checked = !entry?.color;
  $('#entry-size').value = entry?.font_size || '';
  $('#entry-dialog').showModal();
  $('#entry-content').focus();
}
function openTodo(id = null) {
  state.editTodo = id;
  const todo = state.todos.find(item => item.id === id);
  $('#todo-dialog-title').textContent = todo ? '编辑待办' : '新增待办';
  $('#todo-content').value = todo?.content || '';
  $('#todo-due').value = todo?.due || '';
  $('#todo-color').value = todo?.color || state.settings.todoColor;
  $('#todo-inherit-color').checked = !todo?.color;
  $('#todo-size').value = todo?.font_size || '';
  $('#todo-dialog').showModal();
  $('#todo-content').focus();
}
function askDelete(kind, id) {
  state.deleteAction = { kind, id };
  $('#delete-title').textContent = kind === 'entries' ? '删除这条记录？' : '删除这条待办？';
  $('#delete-dialog').showModal();
  $('#cancel-delete').focus();
}
function renderSettings() {
  const settings = state.draftSettings;
  $('#background-options').innerHTML = backgrounds.map(bg => `<button class="background-option${settings.background === bg.id ? ' active' : ''}" data-background="${bg.id}" aria-pressed="${settings.background === bg.id}"><span class="background-preview" style="background-image:url('/backgrounds/${bg.id}.svg')"></span><span class="background-name">${bg.name}</span></button>`).join('') + (settings.customBackground ? `<button class="background-option${settings.background === 'custom' ? ' active' : ''}" data-background="custom" aria-pressed="${settings.background === 'custom'}"><span class="background-preview" style="background-image:url('${settings.customBackground}')"></span><span class="background-name">我的背景</span></button>` : '');
  $('#global-font-size').value = settings.fontSize;
  $('#font-size-value').textContent = `${settings.fontSize} px`;
  $$('[data-setting-color]').forEach(input => { input.value = settings[input.dataset.settingColor]; });
  $('#appearance-preview').style.fontSize = `${settings.fontSize}px`;
  applyAppearance(settings);
}
function openSettings() {
  state.draftSettings = { ...state.settings };
  renderSettings();
  $('#settings-dialog').showModal();
}
async function exportWeek() {
  await saveSummary();
  const info = isoWeek(state.week);
  const lines = [`# ${info.year} 年第 ${info.week} 周`, '', `${state.week} — ${addDays(state.week, 6)}`, '', '## 本周记录', ''];
  let previous;
  for (const entry of state.entries) {
    const group = entry.date || '未指定日期';
    if (group !== previous) { lines.push(`### ${group}`, ''); previous = group; }
    lines.push(`- ${entry.content.replace(/\n/g, '\n  ')}`, '');
  }
  if (state.summary) lines.push('## 周总结', '', state.summary, '');
  const url = URL.createObjectURL(new Blob(['\uFEFF', lines.join('\n')], { type: 'text/markdown;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `周报_${state.week}.md`;
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('周报已导出');
}

on('#previous-month', 'click', () => moveMonth(-1));
on('#next-month', 'click', () => moveMonth(1));
on('#month-picker-button', 'click', () => {
  $('#month-picker').hidden = !$('#month-picker').hidden;
  if (!$('#month-picker').hidden) { $('#month-picker').focus(); try { $('#month-picker').showPicker(); } catch {} }
});
on('#month-picker', 'change', e => {
  if (!/^\d{4}-\d{2}$/.test(e.target.value)) return;
  const [year, month] = e.target.value.split('-').map(Number);
  state.monthYear = year; state.monthIndex = month - 1;
  $('#month-picker').hidden = true; renderCalendar();
});
on('#calendar-grid', 'click', async e => {
  const button = e.target.closest('[data-calendar-date]');
  if (!button) return;
  await navigateWeek(mondayOf(button.dataset.calendarDate), false);
  document.body.classList.remove('sidebar-open');
});
on('#calendar-today', 'click', async () => {
  await navigateWeek(mondayOf(today), false);
  state.monthYear = todayDate.getFullYear(); state.monthIndex = todayDate.getMonth(); renderCalendar();
  document.body.classList.remove('sidebar-open');
});
on('#previous-week', 'click', () => navigateWeek(addDays(requestedWeek, -7)));
on('#next-week', 'click', () => navigateWeek(addDays(requestedWeek, 7)));
on('#go-this-week', 'click', async () => {
  await navigateWeek(mondayOf(today), false);
  state.monthYear = todayDate.getFullYear(); state.monthIndex = todayDate.getMonth(); renderCalendar();
});
on('#week-days', 'click', e => {
  const button = e.target.closest('[data-day]');
  if (!button) return;
  state.selectedDay = state.selectedDay === button.dataset.day ? null : button.dataset.day;
  renderWeekHeader(); renderRecords();
});
on('#all-dates', 'click', () => { state.selectedDay = null; renderWeekHeader(); renderRecords(); });
on('#record-search', 'input', renderRecords);
on('#todo-search', 'input', renderTodos);
on('#records-tab', 'click', () => { state.tab = 'records'; renderTab(); });
on('#summary-tab', 'click', () => { state.tab = 'summary'; renderTab(); });
on('#add-entry', 'click', () => openEntry());
on('#add-todo', 'click', () => openTodo());
on('#add-todo-bottom', 'click', () => openTodo());
on('#add-todo-wide', 'click', () => openTodo());
on('#clear-deadline', 'click', () => { $('#todo-due').value = ''; });
on('#entry-color', 'input', () => { $('#entry-inherit-color').checked = false; });
on('#todo-color', 'input', () => { $('#todo-inherit-color').checked = false; });
on('#entry-form', 'submit', async e => {
  e.preventDefault();
  const button = e.target.querySelector('[type=submit]');
  const content = $('#entry-content').value.trim();
  if (!content) { $('#entry-content').focus(); throw new Error('记录内容不能为空'); }
  const value = { week: state.week, date: $('#entry-date').value || null, content, color: $('#entry-inherit-color').checked ? null : $('#entry-color').value, font_size: $('#entry-size').value ? Number($('#entry-size').value) : null };
  button.disabled = true;
  try {
    await api(state.editEntry ? `/api/entries/${state.editEntry}` : '/api/entries', { method: state.editEntry ? 'PUT' : 'POST', body: value });
    $('#entry-dialog').close();
    // A new undated record must remain visible even when a day filter was active.
    if (state.selectedDay && state.selectedDay !== value.date) state.selectedDay = null;
    $('#record-search').value = '';
    await refreshEntries(); toast('记录已保存');
  } finally { button.disabled = false; }
});
on('#todo-form', 'submit', async e => {
  e.preventDefault();
  const button = e.target.querySelector('[type=submit]');
  const content = $('#todo-content').value.trim();
  if (!content) { $('#todo-content').focus(); throw new Error('待办内容不能为空'); }
  button.disabled = true;
  try {
    await api(state.editTodo ? `/api/todos/${state.editTodo}` : '/api/todos', { method: state.editTodo ? 'PUT' : 'POST', body: { content, due: $('#todo-due').value || null, color: $('#todo-inherit-color').checked ? null : $('#todo-color').value, font_size: $('#todo-size').value ? Number($('#todo-size').value) : null } });
    $('#todo-dialog').close(); await refreshTodos(); toast('待办已保存');
  } finally { button.disabled = false; }
});
on('#confirm-delete', 'click', async e => {
  if (!state.deleteAction) return;
  e.target.disabled = true;
  try {
    const { kind, id } = state.deleteAction;
    await api(`/api/${kind}/${id}`, { method: 'DELETE' });
    $('#delete-dialog').close(); state.deleteAction = null;
    await (kind === 'entries' ? refreshEntries() : refreshTodos()); toast('已删除');
  } finally { e.target.disabled = false; }
});
on('#cancel-delete', 'click', () => $('#delete-dialog').close());
on('#week-summary', 'input', e => {
  state.summary = e.target.value; state.summaryDirty = true;
  $('#summary-length').textContent = `${state.summary.length} 字`;
  updateSummaryStatus('待保存'); clearTimeout(summaryTimer);
  summaryTimer = setTimeout(() => saveSummary().catch(error => toast(error.message, true)), 650);
});
on('#save-summary', 'click', async () => { await saveSummary(); toast('周总结已保存'); });
on('#export-button', 'click', exportWeek);
on('#settings-button', 'click', openSettings);
on('#sidebar-settings', 'click', openSettings);
on('#background-options', 'click', e => {
  const button = e.target.closest('[data-background]');
  if (!button) return;
  state.draftSettings.background = button.dataset.background; renderSettings();
});
on('#global-font-size', 'input', e => { state.draftSettings.fontSize = Number(e.target.value); renderSettings(); });
$$('[data-setting-color]').forEach(input => input.addEventListener('input', () => {
  state.draftSettings[input.dataset.settingColor] = input.value; applyAppearance(state.draftSettings);
}));
on('#background-upload', 'change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 12 * 1024 * 1024) { e.target.value = ''; throw new Error('背景图片不能超过 12 MB'); }
  const draft = state.draftSettings;
  $('#upload-label').textContent = '上传中…';
  $('#save-settings').disabled = true;
  e.target.disabled = true;
  try {
    const uploaded = await api('/api/background', { method: 'POST', body: file });
    if (state.draftSettings !== draft) return;
    draft.customBackground = uploaded.url; draft.background = 'custom'; renderSettings();
  } finally { $('#upload-label').textContent = '上传背景'; e.target.value = ''; e.target.disabled = false; $('#save-settings').disabled = false; }
});
on('#reset-settings', 'click', () => { state.draftSettings = { ...defaults, customBackground: state.draftSettings.customBackground }; renderSettings(); });
on('#save-settings', 'click', async e => {
  e.target.disabled = true;
  try {
    state.settings = await api('/api/settings', { method: 'PUT', body: state.draftSettings });
    $('#settings-dialog').close(); toast('外观已保存');
  } finally { e.target.disabled = false; }
});
$('#settings-dialog').addEventListener('close', () => { applyAppearance(state.settings); state.draftSettings = null; });
on('#mobile-menu', 'click', () => document.body.classList.add('sidebar-open'));
on('#sidebar-scrim', 'click', () => document.body.classList.remove('sidebar-open'));

document.addEventListener('click', async e => {
  try {
    const close = e.target.closest('[data-close-dialog]');
    if (close) return close.closest('dialog').close();
    const view = e.target.closest('[data-view]');
    if (view) { state.view = view.dataset.view; renderView(); document.body.classList.remove('sidebar-open'); return; }
    if (e.target.closest('[data-empty-add]')) return openEntry();
    const editEntry = e.target.closest('[data-edit-entry]');
    if (editEntry) return openEntry(editEntry.dataset.editEntry);
    const deleteEntry = e.target.closest('[data-delete-entry]');
    if (deleteEntry) return askDelete('entries', deleteEntry.dataset.deleteEntry);
    const editTodo = e.target.closest('[data-edit-todo]');
    if (editTodo) return openTodo(editTodo.dataset.editTodo);
    const deleteTodo = e.target.closest('[data-delete-todo]');
    if (deleteTodo) return askDelete('todos', deleteTodo.dataset.deleteTodo);
    const toggle = e.target.closest('[data-toggle-todo]');
    if (toggle) {
      toggle.disabled = true;
      try {
        const todo = state.todos.find(item => item.id === toggle.dataset.toggleTodo);
        await api(`/api/todos/${todo.id}`, { method: 'PUT', body: { completed: !todo.completed } });
        await refreshTodos(); toast(todo.completed ? '已恢复待办' : '已完成');
      } finally { toggle.disabled = false; }
      return;
    }
    const todoFilter = e.target.closest('[data-todo-filter]');
    if (todoFilter) { state.todoFilter = todoFilter.dataset.todoFilter; renderTodos(); return; }
    const wideFilter = e.target.closest('[data-wide-filter]');
    if (wideFilter) { state.wideFilter = wideFilter.dataset.wideFilter; renderTodos(); }
  } catch (error) { toast(error.message, true); }
});
window.addEventListener('beforeunload', e => {
  if (state.summaryDirty || savingCount) { e.preventDefault(); e.returnValue = ''; }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.summaryDirty) saveSummary().catch(() => {});
});
// Deadline badges update as time passes, without requiring a page reload.
setInterval(renderTodos, 60000);

async function init() {
  $('.app-shell').inert = true;
  $('#connection-status').textContent = '读取中…';
  $('#today-label').textContent = `${todayDate.getFullYear()} 年 ${todayDate.getMonth() + 1} 月 ${todayDate.getDate()} 日 · 星期${'日一二三四五六'[todayDate.getDay()]}`;
  $('#footer-year').textContent = todayDate.getFullYear();
  renderWeek(); renderTodos();
  try {
    const [settings, entries, todos, calendar, note] = await Promise.all([api('/api/settings'), api(`/api/entries?week=${state.week}`), api('/api/todos'), api('/api/calendar'), api(`/api/weeks/${state.week}`)]);
    Object.assign(state, { settings, entries, todos, calendar, summary: note.summary });
    $('#week-summary').value = state.summary;
    $('#summary-length').textContent = `${state.summary.length} 字`;
    applyAppearance(settings); renderWeek(); renderTodos();
    $('#connection-status').innerHTML = '<span class="small-dot"></span>已就绪';
  } catch (error) {
    $('#connection-status').textContent = '连接失败';
    toast(error.message, true);
    $('#records-list').innerHTML = `<div class="empty-records">${notebook}<h3>连接失败</h3><button class="quiet-button" id="retry-connection">重新连接</button></div>`;
    $('#retry-connection').addEventListener('click', init);
  } finally { $('.app-shell').inert = false; }
}
init();
