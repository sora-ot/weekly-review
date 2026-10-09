import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, basename, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const tempRoot = resolve(tmpdir());
const data = mkdtempSync(join(tempRoot, 'weekly-review-test-'));
let child, base;
async function launch() {
  child = spawn(process.execPath, ['server.mjs'], { cwd: resolve(import.meta.dirname, '..'), env: { ...process.env, PORT: '0', WEEKLY_DATA_DIR: data }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  await new Promise((resolveLaunch, reject) => {
    const timeout = setTimeout(() => reject(new Error('服务启动超时')), 10000);
    child.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/http:\/\/localhost:(\d+)/);
      if (match) { base = `http://127.0.0.1:${match[1]}`; clearTimeout(timeout); resolveLaunch(); }
    });
    child.on('error', reject);
    child.on('exit', code => { if (!base) reject(new Error(`服务退出 ${code}: ${output}`)); });
  });
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  await new Promise(resolveStop => { child.once('exit', resolveStop); child.kill(); });
}
async function request(path, method = 'GET', value, extra = {}) {
  const response = await fetch(base + path, { method, headers: value ? { 'Content-Type': 'application/json' } : {}, body: value ? JSON.stringify(value) : undefined, ...extra });
  return { status: response.status, body: await response.json() };
}
before(launch);
after(async () => {
  await stop();
  // The recursive cleanup is confined to this test's explicitly created temp directory.
  if (resolve(data).startsWith(tempRoot + sep) && basename(data).startsWith('weekly-review-test-')) rmSync(data, { recursive: true, force: true });
});
test('本地页面和背景可访问，数据库不可公开读取', async () => {
  assert.equal((await fetch(base + '/')).status, 200);
  for (const name of ['mist', 'dusk', 'sage', 'paper']) assert.equal((await fetch(base + `/backgrounds/${name}.svg`)).status, 200);
  assert.equal((await fetch(base + '/data/weekly-review.sqlite3')).status, 404);
});
test('周记录支持不指定日期、指定日期、修改和删除', async () => {
  const first = await request('/api/entries', 'POST', { week: '2026-10-05', content: '未指定日期记录' });
  assert.equal(first.status, 201); assert.equal(first.body.date, null);
  const second = await request('/api/entries', 'POST', { week: '2026-10-05', date: '2026-10-08', content: '周四记录', color: '#334455', font_size: 18 });
  assert.equal(second.status, 201);
  let rows = await request('/api/entries?week=2026-10-05');
  assert.equal(rows.body.length, 2); assert.equal(rows.body[0].id, second.body.id);
  const edit = await request(`/api/entries/${second.body.id}`, 'PUT', { week: '2026-10-05', date: '2026-10-09', content: '修改记录' });
  assert.equal(edit.body.date, '2026-10-09'); assert.equal(edit.body.color, null);
  assert.equal((await request(`/api/entries/${first.body.id}`, 'DELETE')).status, 200);
  assert.equal((await request('/api/entries?week=2026-10-05')).body.length, 1);
});
test('拒绝不存在的日期、跨周日期、非周一和空白记录', async () => {
  for (const value of [
    { week: '2026-10-06', content: 'x' },
    { week: '2026-10-05', date: '2026-10-12', content: 'x' },
    { week: '2026-02-23', date: '2026-02-29', content: 'x' },
    { week: '2026-10-05', content: '   ' },
    { week: '2026-10-05', content: 'x', color: 'red;display:none' },
  ]) assert.equal((await request('/api/entries', 'POST', value)).status, 400);
});
test('跨年一周允许下一年的当周日期', async () => {
  assert.equal((await request('/api/entries', 'POST', { week: '2026-12-28', date: '2027-01-03', content: '跨年记录' })).status, 201);
  const calendar = await request('/api/calendar');
  assert.ok(calendar.body.some(item => item.week === '2026-12-28' && item.count === 1));
});
test('待办保留分钟级截止时间，并可完成、恢复、编辑、删除', async () => {
  const created = await request('/api/todos', 'POST', { content: '分钟级截止测试', due: '2026-10-09T14:37' });
  assert.equal(created.status, 201); assert.equal(created.body.due, '2026-10-09T14:37');
  const path = `/api/todos/${created.body.id}`;
  const complete = await request(path, 'PUT', { completed: true });
  assert.equal(complete.body.completed, 1); assert.equal(complete.body.due, '2026-10-09T14:37');
  assert.equal((await request(path, 'PUT', { completed: false })).body.completed, 0);
  assert.equal((await request(path, 'PUT', { due: null })).body.due, null);
  assert.equal((await request(path, 'DELETE')).status, 200);
  assert.equal((await request(path, 'PUT', { completed: true })).status, 404);
});
test('无截止时间的待办，以及无效截止时间校验', async () => {
  assert.equal((await request('/api/todos', 'POST', { content: '无截止时间' })).body.due, null);
  for (const due of ['2026-10-09T24:01', '2026-10-09T23:60', '2026-02-29T12:00', '2026-10-09T12:00:30']) {
    assert.equal((await request('/api/todos', 'POST', { content: 'x', due })).status, 400);
  }
});
test('旧外观设置自动补齐界面字号和侧栏状态，保留已有字号与颜色', async () => {
  await stop();
  const database = new DatabaseSync(join(data, 'weekly-review.sqlite3'));
  const legacy = { background: 'mist', customBackground: null, fontSize: 20, textColor: '#223344', headingColor: '#345678', entryColor: '#554433', todoColor: '#665544' };
  database.prepare('INSERT INTO settings(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(JSON.stringify(legacy));
  database.close();
  base = null; await launch();
  const settings = (await request('/api/settings')).body;
  assert.deepEqual(settings, { ...legacy, uiFontSize: 16, sidebarCollapsed: false });
});

test('周总结、独立字号、颜色和侧栏状态存入 SQLite，重启仍保留', async () => {
  const note = '完成本周回顾\n下一周继续';
  assert.equal((await request('/api/weeks/2026-10-05', 'PUT', { summary: note })).status, 200);
  const settings = await request('/api/settings', 'PUT', { background: 'dusk', fontSize: 18, uiFontSize: 22, sidebarCollapsed: true, entryColor: '#884422' });
  assert.equal(settings.body.background, 'dusk');
  await stop(); base = null; await launch();
  assert.equal((await request('/api/weeks/2026-10-05')).body.summary, note);
  const reloaded = (await request('/api/settings')).body;
  assert.equal(reloaded.fontSize, 18);
  assert.equal(reloaded.uiFontSize, 22);
  assert.equal(reloaded.sidebarCollapsed, true);
  assert.equal(reloaded.entryColor, '#884422');
  const expanded = (await request('/api/settings', 'PUT', { sidebarCollapsed: false })).body;
  assert.deepEqual(expanded, { ...reloaded, sidebarCollapsed: false });
  const database = new DatabaseSync(join(data, 'weekly-review.sqlite3'), { readOnly: true });
  assert.equal(database.prepare('SELECT summary FROM weeks WHERE week=?').get('2026-10-05').summary, note);
  assert.ok(database.prepare('SELECT COUNT(*) AS n FROM entries').get().n > 0);
  database.close();
});

test('拒绝无效界面字号和侧栏状态，校验失败保留已有外观', async () => {
  const before = (await request('/api/settings')).body;
  for (const uiFontSize of [null, '', '18', 11, 25, 16.5]) {
    assert.equal((await request('/api/settings', 'PUT', { uiFontSize, textColor: '#112233' })).status, 400);
  }
  for (const sidebarCollapsed of [null, 0, 'false', {}, []]) {
    assert.equal((await request('/api/settings', 'PUT', { sidebarCollapsed })).status, 400);
  }
  assert.deepEqual((await request('/api/settings')).body, before);
  for (const uiFontSize of [12, 24]) assert.equal((await request('/api/settings', 'PUT', { uiFontSize })).body.uiFontSize, uiFontSize);
});
test('背景上传保存在本地，禁止伪造图片和外部图片地址', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nS8AAAAASUVORK5CYII=', 'base64');
  const response = await fetch(base + '/api/background', { method: 'POST', body: png });
  assert.equal(response.status, 201);
  const { url } = await response.json();
  assert.deepEqual(readFileSync(join(data, url.slice(1))), png);
  assert.equal((await request('/api/settings', 'PUT', { background: 'custom', customBackground: url })).status, 200);
  assert.equal((await fetch(base + url)).status, 200);
  assert.equal((await fetch(base + '/api/background', { method: 'POST', body: 'not an image' })).status, 400);
  assert.equal((await request('/api/settings', 'PUT', { customBackground: 'https://example.com/x.png' })).status, 400);
});
test('拒绝其他网站向本地服务写入', async () => {
  assert.equal((await request('/api/todos', 'POST', { content: 'x' }, { headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' } })).status, 403);
});

test('所有记录总览包含跨周记录、未指定日期和仅有总结的周，并排除空白总结', async () => {
  const past = await request('/api/entries', 'POST', { week: '2023-06-05', date: '2023-06-06', content: '历史记录' });
  const undated = await request('/api/entries', 'POST', { week: '2024-01-01', content: '不指定日期', color: '#775533', font_size: 18 });
  const dated = await request('/api/entries', 'POST', { week: '2024-01-01', date: '2024-01-03', content: '指定日期' });
  await request('/api/weeks/2024-01-01', 'PUT', { summary: '新年周总结' });
  await request('/api/weeks/2025-06-02', 'PUT', { summary: '只有周总结的一周' });
  await request('/api/weeks/2025-06-09', 'PUT', { summary: '\n \t' });
  const overview = await request('/api/overview');
  assert.equal(overview.status, 200);
  const ids = new Set([past.body.id, undated.body.id, dated.body.id]);
  assert.deepEqual(overview.body.entries.filter(entry => ids.has(entry.id)).map(entry => entry.id), [dated.body.id, undated.body.id, past.body.id]);
  const styled = overview.body.entries.find(entry => entry.id === undated.body.id);
  assert.equal(styled.date, null);
  assert.equal(styled.color, '#775533');
  assert.equal(styled.font_size, 18);
  assert.ok(overview.body.summaries.some(note => note.week === '2025-06-02' && note.summary === '只有周总结的一周'));
  assert.ok(!overview.body.summaries.some(note => note.week === '2025-06-09'));
  await request(`/api/entries/${past.body.id}`, 'PUT', { week: '2023-06-05', date: '2023-06-07', content: '修改历史记录' });
  const updated = await request('/api/overview');
  assert.equal(updated.body.entries.find(entry => entry.id === past.body.id).week, '2023-06-05');
  assert.equal(updated.body.entries.find(entry => entry.id === past.body.id).content, '修改历史记录');
});
