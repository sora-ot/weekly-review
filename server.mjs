import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(process.env.WEEKLY_DATA_DIR || resolve(ROOT, 'data'));
const PUBLIC = resolve(ROOT, 'public');
mkdirSync(resolve(DATA, 'uploads'), { recursive: true });
const db = new DatabaseSync(resolve(DATA, 'weekly-review.sqlite3'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY, week TEXT NOT NULL, date TEXT, content TEXT NOT NULL,
    color TEXT, font_size INTEGER, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS entries_week ON entries(week);
  CREATE TABLE IF NOT EXISTS weeks (week TEXT PRIMARY KEY, summary TEXT NOT NULL DEFAULT '');
  CREATE TABLE IF NOT EXISTS todos (
    id TEXT PRIMARY KEY, content TEXT NOT NULL, due TEXT, completed INTEGER NOT NULL DEFAULT 0,
    color TEXT, font_size INTEGER, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id = 1), value TEXT NOT NULL);
`);

const defaults = { background: 'mist', customBackground: null, fontSize: 15, textColor: '#444c45', headingColor: '#253b2d', entryColor: '#444c45', todoColor: '#444c45' };
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = message => { throw new HttpError(400, message); };
function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function weekValue(value) {
  if (!isDate(value) || new Date(`${value}T12:00:00Z`).getUTCDay() !== 1) fail('请选择有效的周一日期');
  return value;
}
function contentValue(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 10000) fail('内容不能为空，最多 10000 字');
  return value.trim();
}
function colorValue(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^#[\da-f]{6}$/i.test(value)) fail('请选择有效的颜色');
  return value;
}
function sizeValue(value) {
  if (value == null || value === '') return null;
  if (!Number.isInteger(value) || value < 12 || value > 28) fail('字号范围为 12–28');
  return value;
}
function dueValue(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || !isDate(value.slice(0, 10)) || Number(value.slice(11, 13)) > 23 || Number(value.slice(14)) > 59) fail('请选择有效的截止时间');
  return value;
}
function entryValue(body) {
  const week = weekValue(body.week);
  const date = body.date || null;
  if (date) {
    if (!isDate(date)) fail('请选择有效的记录日期');
    const distance = (new Date(`${date}T12:00:00Z`) - new Date(`${week}T12:00:00Z`)) / 86400000;
    if (distance < 0 || distance > 6) fail('记录日期必须在所选周内');
  }
  return { week, date, content: contentValue(body.content), color: colorValue(body.color), font_size: sizeValue(body.font_size) };
}
function todoValue(body) {
  return { content: contentValue(body.content), due: dueValue(body.due), color: colorValue(body.color), font_size: sizeValue(body.font_size) };
}
function settingsValue(body) {
  const current = readSettings();
  const result = { ...current };
  for (const key of ['textColor', 'headingColor', 'entryColor', 'todoColor']) if (key in body) result[key] = colorValue(body[key]) || defaults[key];
  if ('fontSize' in body) result.fontSize = sizeValue(body.fontSize) || defaults.fontSize;
  if ('background' in body) {
    if (!['mist', 'dusk', 'sage', 'paper', 'custom'].includes(body.background)) fail('背景不存在');
    result.background = body.background;
  }
  if ('customBackground' in body) {
    if (body.customBackground !== null && (typeof body.customBackground !== 'string' || !/^\/uploads\/[\da-f-]+\.(png|jpg|webp)$/.test(body.customBackground) || !existsSync(resolve(DATA, body.customBackground.slice(1))))) fail('背景图片不存在');
    result.customBackground = body.customBackground;
  }
  if (result.background === 'custom' && !result.customBackground) fail('请先选择背景图片');
  return result;
}
function readSettings() {
  const row = db.prepare('SELECT value FROM settings WHERE id = 1').get();
  return { ...defaults, ...(row ? JSON.parse(row.value) : {}) };
}
function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolveBody, reject) => {
    const parts = []; let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { reject(new HttpError(413, '文件过大')); return; }
      parts.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(parts)));
    req.on('error', reject);
  });
}
async function jsonBody(req) {
  try {
    const body = JSON.parse((await readBody(req)).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail('请求格式无效');
    return body;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, '请求格式无效');
  }
}
function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
function rowOr404(table, id) {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!row) throw new HttpError(404, '内容不存在');
  return row;
}
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const method = req.method;
    // Only the local app may write to its database.
    if (!['GET', 'HEAD'].includes(method)) {
      const origin = req.headers.origin;
      if (origin && origin !== `http://${req.headers.host}`) throw new HttpError(403, '请求来源无效');
    }
    if (path === '/api/settings') {
      if (method === 'GET') return json(res, 200, readSettings());
      if (method === 'PUT') {
        const result = settingsValue(await jsonBody(req));
        db.prepare('INSERT INTO settings(id, value) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value').run(JSON.stringify(result));
        return json(res, 200, result);
      }
    }
    if (path === '/api/entries') {
      if (method === 'GET') {
        const week = weekValue(url.searchParams.get('week'));
        return json(res, 200, db.prepare('SELECT * FROM entries WHERE week = ? ORDER BY date IS NULL, date, created_at').all(week));
      }
      if (method === 'POST') {
        const value = entryValue(await jsonBody(req));
        const id = randomUUID();
        db.prepare('INSERT INTO entries VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, value.week, value.date, value.content, value.color, value.font_size, new Date().toISOString());
        return json(res, 201, rowOr404('entries', id));
      }
    }
    const entryMatch = path.match(/^\/api\/entries\/([\da-f-]+)$/);
    if (entryMatch) {
      const id = entryMatch[1]; rowOr404('entries', id);
      if (method === 'PUT') {
        const value = entryValue(await jsonBody(req));
        db.prepare('UPDATE entries SET week=?, date=?, content=?, color=?, font_size=? WHERE id=?').run(value.week, value.date, value.content, value.color, value.font_size, id);
        return json(res, 200, rowOr404('entries', id));
      }
      if (method === 'DELETE') {
        db.prepare('DELETE FROM entries WHERE id=?').run(id);
        return json(res, 200, { ok: true });
      }
    }
    if (path === '/api/calendar' && method === 'GET') {
      return json(res, 200, db.prepare('SELECT week, COUNT(*) AS count FROM entries GROUP BY week').all());
    }
    const weekMatch = path.match(/^\/api\/weeks\/(\d{4}-\d{2}-\d{2})$/);
    if (weekMatch) {
      const week = weekValue(weekMatch[1]);
      if (method === 'GET') return json(res, 200, db.prepare('SELECT summary FROM weeks WHERE week=?').get(week) || { summary: '' });
      if (method === 'PUT') {
        const body = await jsonBody(req);
        if (typeof body.summary !== 'string' || body.summary.length > 30000) fail('周总结最多 30000 字');
        db.prepare('INSERT INTO weeks VALUES(?, ?) ON CONFLICT(week) DO UPDATE SET summary=excluded.summary').run(week, body.summary);
        return json(res, 200, { summary: body.summary });
      }
    }
    if (path === '/api/todos') {
      if (method === 'GET') return json(res, 200, db.prepare('SELECT * FROM todos ORDER BY completed, due IS NULL, due, created_at DESC').all());
      if (method === 'POST') {
        const value = todoValue(await jsonBody(req)); const id = randomUUID();
        db.prepare('INSERT INTO todos VALUES(?, ?, ?, 0, ?, ?, ?)').run(id, value.content, value.due, value.color, value.font_size, new Date().toISOString());
        return json(res, 201, rowOr404('todos', id));
      }
    }
    const todoMatch = path.match(/^\/api\/todos\/([\da-f-]+)$/);
    if (todoMatch) {
      const id = todoMatch[1]; const current = rowOr404('todos', id);
      if (method === 'PUT') {
        const body = await jsonBody(req); const value = todoValue({ ...current, ...body });
        const completed = 'completed' in body ? body.completed : Boolean(current.completed);
        if (typeof completed !== 'boolean') fail('完成状态无效');
        db.prepare('UPDATE todos SET content=?, due=?, completed=?, color=?, font_size=? WHERE id=?').run(value.content, value.due, Number(completed), value.color, value.font_size, id);
        return json(res, 200, rowOr404('todos', id));
      }
      if (method === 'DELETE') { db.prepare('DELETE FROM todos WHERE id=?').run(id); return json(res, 200, { ok: true }); }
    }
    if (path === '/api/background' && method === 'POST') {
      const buffer = await readBody(req, 12 * 1024 * 1024);
      let extension;
      if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) extension = 'png';
      else if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) extension = 'jpg';
      else if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') extension = 'webp';
      else fail('请选择 PNG、JPG 或 WebP 图片');
      const filename = `${randomUUID()}.${extension}`;
      writeFileSync(resolve(DATA, 'uploads', filename), buffer);
      return json(res, 201, { url: `/uploads/${filename}` });
    }
    if (path.startsWith('/api/')) throw new HttpError(404, '接口不存在');
    if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, '请求方式无效');
    const base = path.startsWith('/uploads/') ? resolve(DATA, 'uploads') : PUBLIC;
    const relative = path.startsWith('/uploads/') ? path.slice('/uploads/'.length) : (path === '/' ? 'index.html' : path.slice(1));
    let filename;
    try { filename = resolve(base, decodeURIComponent(relative)); } catch { throw new HttpError(400, '路径无效'); }
    if (!filename.startsWith(base + sep) || !existsSync(filename)) throw new HttpError(404, '文件不存在');
    const type = mime[extname(filename)];
    if (!type) throw new HttpError(404, '文件不存在');
    const data = readFileSync(filename);
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': data.length, 'Cache-Control': 'no-cache' });
    res.end(method === 'HEAD' ? undefined : data);
  } catch (error) {
    if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : '保存失败，请稍后重试' });
    if (!error.status) console.error(error);
  }
});
const port = Number(process.env.PORT || 3000);
server.listen(port, '127.0.0.1', () => {
  const address = `http://localhost:${server.address().port}`;
  console.log(`拾周已启动：${address}\n数据目录：${DATA}`);
  if (process.env.WEEKLY_OPEN_BROWSER === '1' && process.platform === 'win32') {
    const browser = spawn('cmd.exe', ['/c', 'start', '', address], { windowsHide: true, stdio: 'ignore' });
    browser.on('error', () => console.log(`请在浏览器中打开 ${address}`));
    browser.unref();
  }
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
