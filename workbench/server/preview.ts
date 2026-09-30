// 预览会话：每个会话一个独立端口（= 独立源），把模型产物与工作台 API 隔离。
//   static：以某目录为根的静态服务（支持 Range，可播放视频；HTML 注入 bridge）
//   proxy ：反向代理到模型的开发服务器（含 WebSocket/HMR；HTML 注入 bridge）
//   url   ：直接加载的外部地址（不注入；桌面版用 webview 原生控制台捕获）
// bridge 把 console / 运行时异常 / 资源失败 / fetch+XHR 回传到 /__wb/log → 服务端日志 → UI 控制台 + CLI。
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import type { LogEntry, PreviewKind, PreviewSession, RequestEntry } from '../shared/types';
import { BRIDGE_JS } from './bridge-script';
import { EventHub, HttpError, mimeOf, readBody } from './http';

interface Sess extends PreviewSession {
  server?: http.Server; logs: LogEntry[]; requests: RequestEntry[]; seq: number;
  pendingReq: RequestEntry[]; reqTimer?: NodeJS.Timeout;
}

const MAX_LOGS = 3000, MAX_REQ = 1500;

export class Previews {
  sessions = new Map<string, Sess>();
  private n = 0;
  constructor(private hub: EventHub, private range: [number, number]) {}

  public(s: Sess): PreviewSession {
    const { server: _s, logs: _l, requests: _r, seq: _q, pendingReq: _p, reqTimer: _t, ...pub } = s;
    return pub;
  }
  list() { return [...this.sessions.values()].map((s) => this.public(s)); }
  get(id: string) {
    const s = this.sessions.get(id);
    if (!s) throw new HttpError(404, `预览会话不存在：${id}`);
    return s;
  }

  private newSess(kind: PreviewKind, label: string, extra: Partial<Sess>): Sess {
    const id = `p${(++this.n).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    return { id, kind, label, url: '', created_at: Date.now(), inject: kind !== 'url', counts: { error: 0, warn: 0, log: 0, failed: 0 }, logs: [], requests: [], seq: 0, pendingReq: [], ...extra };
  }

  async listen(server: http.Server): Promise<number> {
    for (let p = this.range[0]; p <= this.range[1]; p++) {
      const used = [...this.sessions.values()].some((s) => s.port === p);
      if (used) continue;
      const ok = await new Promise<boolean>((resolve) => {
        const onErr = () => { server.off('listening', onOk); resolve(false); };
        const onOk = () => { server.off('error', onErr); resolve(true); };
        server.once('error', onErr);
        server.once('listening', onOk);
        server.listen(p, '127.0.0.1');
      });
      if (ok) return p;
    }
    throw new HttpError(503, `预览端口 ${this.range[0]}–${this.range[1]} 已全部占用，请关闭一些预览会话`);
  }

  /** 以目录为根的静态预览。reuse：同根目录已有会话时复用（避免端口泄漏）。 */
  async createStatic(opts: { root: string; entry?: string; label?: string; inject?: boolean }): Promise<PreviewSession> {
    const root = path.resolve(opts.root);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new HttpError(400, `目录不存在：${root}`);
    const entry = (opts.entry || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const existing = [...this.sessions.values()].find((s) => s.kind === 'static' && s.root === root && s.inject === (opts.inject !== false));
    if (existing) {
      existing.entry = entry;
      existing.url = `http://127.0.0.1:${existing.port}/${encodePath(entry)}`;
      existing.label = opts.label || existing.label;
      this.hub.emit({ type: 'session', id: existing.id, session: this.public(existing) });
      return this.public(existing);
    }
    const s = this.newSess('static', opts.label || path.basename(root), { root, entry, inject: opts.inject !== false });
    s.server = http.createServer((req, res) => this.handleStatic(s, req, res).catch((e) => { res.writeHead(500); res.end(String(e)); }));
    s.port = await this.listen(s.server);
    s.url = `http://127.0.0.1:${s.port}/${encodePath(entry)}`;
    this.sessions.set(s.id, s);
    this.system(s, `静态预览已启动：${root}`);
    this.hub.emit({ type: 'session', id: s.id, session: this.public(s) });
    return this.public(s);
  }

  /** 反向代理到开发服务器（target 如 http://localhost:5173） */
  async createProxy(opts: { target: string; label?: string; proc_id?: string }): Promise<PreviewSession> {
    let t: URL;
    try { t = new URL(opts.target); } catch { throw new HttpError(400, `地址不合法：${opts.target}`); }
    if (!/^https?:$/.test(t.protocol)) throw new HttpError(400, '只支持 http(s) 开发服务器');
    const existing = [...this.sessions.values()].find((s) => s.kind === 'proxy' && s.target === t.origin);
    if (existing) return this.public(existing);
    const s = this.newSess('proxy', opts.label || t.host, { target: t.origin, proc_id: opts.proc_id, entry: (t.pathname + t.search).replace(/^\//, '') });
    s.server = http.createServer((req, res) => this.handleProxy(s, t, req, res));
    s.server.on('upgrade', (req, socket, head) => this.handleUpgrade(t, req, socket as net.Socket, head));
    s.port = await this.listen(s.server);
    s.url = `http://127.0.0.1:${s.port}/${s.entry || ''}`;
    this.sessions.set(s.id, s);
    this.system(s, `开发服务器代理已启动：${t.origin} → 127.0.0.1:${s.port}`);
    this.hub.emit({ type: 'session', id: s.id, session: this.public(s) });
    return this.public(s);
  }

  createUrl(opts: { url: string; label?: string }): PreviewSession {
    let u: URL;
    try { u = new URL(opts.url); } catch { throw new HttpError(400, `地址不合法：${opts.url}`); }
    const s = this.newSess('url', opts.label || u.host, { url: u.href, target: u.origin, inject: false });
    this.sessions.set(s.id, s);
    this.hub.emit({ type: 'session', id: s.id, session: this.public(s) });
    return this.public(s);
  }

  close(id: string) {
    const s = this.sessions.get(id);
    if (!s) return false;
    s.server?.closeAllConnections?.();
    s.server?.close();
    this.sessions.delete(id);
    this.hub.emit({ type: 'session', id, session: null });
    return true;
  }
  closeAll() { for (const id of [...this.sessions.keys()]) this.close(id); }

  // ---------- 日志 ----------
  addLogs(id: string, entries: Partial<LogEntry>[]) {
    const s = this.sessions.get(id);
    if (!s) return;
    const out: LogEntry[] = [];
    for (const e of entries.slice(0, 500)) {
      const lv = (e.level || 'log') as LogEntry['level'];
      const entry: LogEntry = {
        seq: ++s.seq, ts: Number(e.ts) || Date.now(), level: lv, text: String(e.text ?? '').slice(0, 20000), src: (e.src as LogEntry['src']) || 'page',
        url: e.url ? String(e.url).slice(0, 2000) : undefined, line: e.line, col: e.col, stack: e.stack ? String(e.stack).slice(0, 8000) : undefined,
        status: e.status, method: e.method, ms: e.ms,
      };
      // 连续重复消息折叠（与 DevTools 相同）
      const last = s.logs[s.logs.length - 1];
      if (last && last.text === entry.text && last.level === entry.level && last.url === entry.url && entry.level !== 'network') {
        last.count = (last.count || 1) + 1; last.ts = entry.ts;
        out.push(last);
        continue;
      }
      s.logs.push(entry);
      out.push(entry);
      if (lv === 'error' || lv === 'resource' || (lv === 'network' && (!e.status || e.status >= 400))) s.counts.error++;
      else if (lv === 'warn') s.counts.warn++;
      else s.counts.log++;
      if (lv === 'network' && (!e.status || e.status >= 400)) s.counts.failed++;
    }
    if (s.logs.length > MAX_LOGS) s.logs.splice(0, s.logs.length - MAX_LOGS);
    if (out.length) {
      this.hub.emit({ type: 'log', session: id, entries: out });
      this.hub.emit({ type: 'session', id, session: this.public(s) });
    }
  }
  logs(id: string, since = 0, levels?: string[]) {
    const s = this.get(id);
    return s.logs.filter((l) => l.seq > since && (!levels || levels.includes(l.level)));
  }
  requests(id: string, since = 0) { return this.get(id).requests.filter((r) => r.seq > since); }
  clear(id: string) {
    const s = this.get(id);
    s.logs = []; s.requests = []; s.counts = { error: 0, warn: 0, log: 0, failed: 0 };
    this.hub.emit({ type: 'session', id, session: this.public(s) });
  }
  system(s: Sess, text: string) { this.addLogs(s.id, [{ level: 'system', src: 'server', text }]); }

  private recordReq(s: Sess, r: Omit<RequestEntry, 'seq'>) {
    const e: RequestEntry = { ...r, seq: ++s.seq };
    s.requests.push(e);
    if (s.requests.length > MAX_REQ) s.requests.splice(0, s.requests.length - MAX_REQ);
    if (r.status >= 400 || r.status === 0) this.addLogs(s.id, [{ level: 'network', src: 'server', method: r.method, url: r.url, status: r.status, ms: r.ms, text: `${r.method} ${r.url} → ${r.status || '失败'}` }]);
    s.pendingReq.push(e);
    if (!s.reqTimer) s.reqTimer = setTimeout(() => {
      s.reqTimer = undefined;
      this.hub.emit({ type: 'request', session: s.id, entries: s.pendingReq.splice(0) });
    }, 150);
  }

  /** bridge 自身的端点：/__wb/bridge.js 与 /__wb/log */
  private async handleBridge(s: Sess, req: http.IncomingMessage, res: http.ServerResponse, pathname: string): Promise<boolean> {
    if (pathname === '/__wb/bridge.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
      res.end(BRIDGE_JS.replace('__SID__', s.id));
      return true;
    }
    if (pathname === '/__wb/log' && req.method === 'POST') {
      try {
        const body = JSON.parse((await readBody(req, 4 * 1024 * 1024)).toString('utf8'));
        this.addLogs(s.id, Array.isArray(body) ? body : [body]);
      } catch { /* 忽略坏包 */ }
      res.writeHead(204); res.end();
      return true;
    }
    return false;
  }

  private async handleStatic(s: Sess, req: http.IncomingMessage, res: http.ServerResponse) {
    const t0 = Date.now();
    const u = new URL(req.url || '/', 'http://x');
    let pathname: string;
    try { pathname = decodeURIComponent(u.pathname); } catch { pathname = u.pathname; }
    if (await this.handleBridge(s, req, res, pathname)) return;
    const done = (status: number, bytes: number, type: string) => this.recordReq(s, { ts: t0, method: req.method || 'GET', url: u.pathname + u.search, status, bytes, ms: Date.now() - t0, type, src: 'server' });
    const abs = path.resolve(s.root!, '.' + pathname);
    const relp = path.relative(s.root!, abs);
    if (relp.startsWith('..') || path.isAbsolute(relp)) { res.writeHead(403); res.end('forbidden'); return done(403, 0, ''); }
    let file = abs;
    let st: fs.Stats | null = null;
    try { st = fs.statSync(file); } catch { /* 404 */ }
    if (st?.isDirectory()) {
      if (!pathname.endsWith('/')) { res.writeHead(301, { location: u.pathname + '/' + u.search }); res.end(); return done(301, 0, ''); }
      const idx = path.join(file, 'index.html');
      if (fs.existsSync(idx)) { file = idx; st = fs.statSync(idx); }
      else {
        const html = dirListing(pathname, file);
        const body = Buffer.from(s.inject ? injectBridge(html) : html);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(body);
        return done(200, body.length, 'text/html');
      }
    }
    if (!st) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`404 Not Found: ${pathname}`);
      return done(404, 0, '');
    }
    const type = mimeOf(file);
    const headers: http.OutgoingHttpHeaders = { 'content-type': type, 'cache-control': 'no-store', 'accept-ranges': 'bytes', 'access-control-allow-origin': '*' };
    if (s.inject && type.startsWith('text/html')) {
      const body = Buffer.from(injectBridge(fs.readFileSync(file, 'utf8')));
      res.writeHead(200, { ...headers, 'content-length': body.length });
      res.end(req.method === 'HEAD' ? undefined : body);
      return done(200, body.length, type);
    }
    const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
    if (range) {
      const size = st.size;
      let start = range[1] ? Number(range[1]) : size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : size - 1;
      if (!range[1]) end = size - 1;
      start = Math.max(0, start); end = Math.min(end, size - 1);
      if (start > end) { res.writeHead(416, { 'content-range': `bytes */${size}` }); res.end(); return done(416, 0, type); }
      res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
      if (req.method === 'HEAD') { res.end(); return done(206, 0, type); }
      fs.createReadStream(file, { start, end }).pipe(res);
      return done(206, end - start + 1, type);
    }
    res.writeHead(200, { ...headers, 'content-length': st.size });
    if (req.method === 'HEAD') { res.end(); return done(200, 0, type); }
    fs.createReadStream(file).pipe(res);
    done(200, st.size, type);
  }

  private handleProxy(s: Sess, t: URL, req: http.IncomingMessage, res: http.ServerResponse) {
    const t0 = Date.now();
    const u = new URL(req.url || '/', 'http://x');
    void (async () => {
      if (await this.handleBridge(s, req, res, u.pathname)) return;
      const headers = { ...req.headers, host: t.host, 'accept-encoding': 'identity' } as http.OutgoingHttpHeaders;
      if (headers.origin) headers.origin = t.origin;
      if (headers.referer) headers.referer = String(headers.referer).replace(/^https?:\/\/127\.0\.0\.1:\d+/, t.origin);
      const up = http.request({ protocol: t.protocol, hostname: t.hostname, port: t.port || 80, method: req.method, path: req.url, headers }, (ur) => {
        const type = String(ur.headers['content-type'] || '');
        const h = { ...ur.headers };
        if (h.location) h.location = String(h.location).replace(t.origin, `http://127.0.0.1:${s.port}`);
        const rec = (bytes: number) => this.recordReq(s, { ts: t0, method: req.method || 'GET', url: u.pathname + u.search, status: ur.statusCode || 0, bytes, ms: Date.now() - t0, type: type.split(';')[0], src: 'server' });
        if (s.inject && type.includes('text/html') && (ur.statusCode || 0) < 300) {
          const chunks: Buffer[] = [];
          ur.on('data', (c) => chunks.push(c));
          ur.on('end', () => {
            const body = Buffer.from(injectBridge(Buffer.concat(chunks).toString('utf8')));
            delete h['content-length']; delete h['transfer-encoding'];
            res.writeHead(ur.statusCode || 200, { ...h, 'content-length': body.length, 'cache-control': 'no-store' });
            res.end(body);
            rec(body.length);
          });
          return;
        }
        res.writeHead(ur.statusCode || 502, h);
        let n = 0;
        ur.on('data', (c) => { n += c.length; });
        ur.on('end', () => rec(n));
        ur.pipe(res);
      });
      up.on('error', (e) => {
        if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<meta charset="utf-8"><body style="font:14px system-ui;padding:24px;color:#c33">开发服务器无响应：${t.origin}<br><small>${String(e.message).replace(/</g, '&lt;')}</small></body>`);
        this.recordReq(s, { ts: t0, method: req.method || 'GET', url: u.pathname + u.search, status: 0, bytes: 0, ms: Date.now() - t0, type: '', src: 'server' });
      });
      req.pipe(up);
    })();
  }

  private handleUpgrade(t: URL, req: http.IncomingMessage, socket: net.Socket, head: Buffer) {
    const up = net.connect(Number(t.port || 80), t.hostname, () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const k = req.rawHeaders[i], lk = k.toLowerCase();
        let v = req.rawHeaders[i + 1];
        if (lk === 'host') v = t.host;
        if (lk === 'origin') v = t.origin;
        lines.push(`${k}: ${v}`);
      }
      up.write(lines.join('\r\n') + '\r\n\r\n');
      if (head?.length) up.write(head);
      socket.pipe(up).pipe(socket);
    });
    up.on('error', () => socket.destroy());
    socket.on('error', () => up.destroy());
  }
}

const TAG = '<script src="/__wb/bridge.js" data-wb-bridge></script>';
/** 在 <head> 最前面注入（尽早捕获错误）；无 head 时放在 <html> 后或文档最前。 */
export function injectBridge(html: string): string {
  if (html.includes('data-wb-bridge')) return html;
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + TAG + html.slice(head.index + head[0].length);
  const h = /<html(\s[^>]*)?>/i.exec(html);
  if (h) return html.slice(0, h.index + h[0].length) + TAG + html.slice(h.index + h[0].length);
  const dt = /<!doctype[^>]*>/i.exec(html);
  if (dt) return html.slice(0, dt.index + dt[0].length) + TAG + html.slice(dt.index + dt[0].length);
  return TAG + html;
}

const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

function dirListing(urlPath: string, dir: string): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  let items: fs.Dirent[] = [];
  try { items = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.name !== 'node_modules' && !d.name.startsWith('.')); } catch { /* */ }
  items.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  const rows = items.map((d) => `<li><a href="${encodeURIComponent(d.name)}${d.isDirectory() ? '/' : ''}">${d.isDirectory() ? '📁' : '📄'} ${esc(d.name)}${d.isDirectory() ? '/' : ''}</a></li>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(urlPath)}</title><style>body{font:14px/1.6 system-ui,"Microsoft YaHei";margin:24px;color:#1b2230;background:#f6f7f9}@media(prefers-color-scheme:dark){body{background:#12151b;color:#e6e9ef}a{color:#8aa4ff}}ul{list-style:none;padding:0}li{padding:3px 0}a{text-decoration:none;color:#2c4bc7}</style></head><body><h3>${esc(urlPath)}</h3><ul>${urlPath !== '/' ? '<li><a href="../">⬆ ..</a></li>' : ''}${rows}</ul></body></html>`;
}
