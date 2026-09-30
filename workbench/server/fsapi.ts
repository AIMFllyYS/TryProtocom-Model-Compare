import fs from 'node:fs';
import path from 'node:path';
import type http from 'node:http';
import { HttpError, mimeOf } from './http';

/** 只允许访问仓库根目录下的这些子树（相对路径，/ 分隔） */
const ALLOWED = ['model', 'bench-data', 'reports', 'data', 'skills', 'workbench/.runtime', 'benchmark-spec.html', 'README.md'];

export function resolveSafe(root: string, rel: string): string {
  const clean = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const abs = path.resolve(root, clean);
  const r = path.relative(root, abs).split(path.sep).join('/');
  if (r.startsWith('..') || path.isAbsolute(r)) throw new HttpError(403, '路径越界');
  if (r && !ALLOWED.some((a) => r === a || r.startsWith(a + '/'))) throw new HttpError(403, `不允许访问：${r}`);
  return abs;
}
export const toRel = (root: string, abs: string) => path.relative(root, abs).split(path.sep).join('/');

export function listDir(root: string, rel: string) {
  const abs = resolveSafe(root, rel);
  let ents: fs.Dirent[];
  try { ents = fs.readdirSync(abs, { withFileTypes: true }); } catch { throw new HttpError(404, `目录不存在：${rel}`); }
  const rows = ents
    .filter((d) => d.name !== 'node_modules' && d.name !== '.git' && d.name !== '__pycache__' && d.name !== '.venv')
    .map((d) => {
      const p = path.join(abs, d.name);
      let size = 0, mtime = 0;
      try { const st = fs.statSync(p); size = st.size; mtime = st.mtimeMs; } catch { /* */ }
      return { name: d.name, dir: d.isDirectory(), size, mtime, path: toRel(root, p) };
    })
    .filter((x) => !rel && !x.dir ? ALLOWED.includes(x.name) : !rel ? ALLOWED.some((a) => a === x.name || a.startsWith(x.name + '/')) : true);
  rows.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { path: rel, entries: rows };
}

export function readText(root: string, rel: string, max = 2 * 1024 * 1024) {
  const abs = resolveSafe(root, rel);
  let st: fs.Stats;
  try { st = fs.statSync(abs); } catch { throw new HttpError(404, `文件不存在：${rel}`); }
  if (st.isDirectory()) throw new HttpError(400, '这是目录');
  const fd = fs.openSync(abs, 'r');
  const len = Math.min(st.size, max);
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, 0);
  fs.closeSync(fd);
  const binary = buf.subarray(0, 4000).includes(0);
  return { path: rel, size: st.size, truncated: st.size > max, binary, text: binary ? '' : buf.toString('utf8'), mtime: st.mtimeMs };
}

/** 原样输出文件（图片/视频/下载）。CSP sandbox 保证 HTML 等在工作台源下不会执行脚本。支持 Range。 */
export function sendRaw(root: string, rel: string, req: http.IncomingMessage, res: http.ServerResponse, download = false) {
  const abs = resolveSafe(root, rel);
  let st: fs.Stats;
  try { st = fs.statSync(abs); } catch { throw new HttpError(404, `文件不存在：${rel}`); }
  if (st.isDirectory()) throw new HttpError(400, '这是目录');
  const type = mimeOf(abs);
  const headers: http.OutgoingHttpHeaders = {
    'content-type': type.startsWith('text/html') ? 'text/plain; charset=utf-8' : type,
    'content-security-policy': 'sandbox', 'x-content-type-options': 'nosniff', 'accept-ranges': 'bytes', 'cache-control': 'no-cache',
  };
  if (download) headers['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(abs))}`;
  const m = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
  if (m) {
    const size = st.size;
    let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    end = Math.min(end, size - 1); start = Math.max(0, start);
    if (start > end) { res.writeHead(416, { 'content-range': `bytes */${size}` }); res.end(); return; }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    fs.createReadStream(abs, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, 'content-length': st.size });
  fs.createReadStream(abs).pipe(res);
}
