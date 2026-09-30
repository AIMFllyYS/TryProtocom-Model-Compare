import type http from 'node:http';
import type { WbEvent } from '../shared/types';

export type Req = http.IncomingMessage & { query: URLSearchParams; params: Record<string, string>; pathname: string };
export type Res = http.ServerResponse;
export type Handler = (req: Req, res: Res) => unknown | Promise<unknown>;

export class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

interface Route { method: string; re: RegExp; keys: string[]; fn: Handler; open: boolean }

export class Router {
  routes: Route[] = [];
  /** open=true：GET 只读接口；其余需要 x-wb-token */
  add(method: string, pattern: string, fn: Handler, open = method === 'GET') {
    const keys: string[] = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)(\*)?/g, (_m, k: string, star: string) => { keys.push(k); return star ? '(.+)' : '([^/]+)'; }) + '$');
    this.routes.push({ method, re, keys, fn, open });
  }
  get(p: string, fn: Handler) { this.add('GET', p, fn); }
  post(p: string, fn: Handler) { this.add('POST', p, fn); }
  patch(p: string, fn: Handler) { this.add('PATCH', p, fn); }
  del(p: string, fn: Handler) { this.add('DELETE', p, fn); }
  match(method: string, pathname: string) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(pathname);
      if (m) return { route: r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    }
    return null;
  }
}

export function sendJson(res: Res, status: number, data: unknown) {
  const body = JSON.stringify(data, (_k, v) => (v === Infinity ? 'inf' : v));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

export async function readBody(req: http.IncomingMessage, limit = 50 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > limit) throw new HttpError(413, '请求体过大');
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

export async function readJson<T = any>(req: http.IncomingMessage): Promise<T> {
  const b = await readBody(req);
  if (!b.length) return {} as T;
  try { return JSON.parse(b.toString('utf8')); } catch { throw new HttpError(400, 'JSON 解析失败'); }
}

/** Server-Sent Events 广播中心 */
export class EventHub {
  clients = new Set<Res>();
  attach(res: Res) {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ type: 'hello', at: Date.now() })}\n\n`);
    this.clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    res.on('close', () => { clearInterval(ping); this.clients.delete(res); });
  }
  emit(ev: WbEvent) {
    const s = `data: ${JSON.stringify(ev, (_k, v) => (v === Infinity ? 'inf' : v))}\n\n`;
    for (const c of this.clients) c.write(s);
  }
}

export const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.ico': 'image/x-icon', '.bmp': 'image/bmp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.flac': 'audio/flac', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.otf': 'font/otf', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.hdr': 'application/octet-stream', '.ktx2': 'image/ktx2',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.yaml': 'text/yaml; charset=utf-8', '.yml': 'text/yaml; charset=utf-8',
  '.srt': 'text/plain; charset=utf-8', '.vtt': 'text/vtt; charset=utf-8', '.xml': 'application/xml', '.pdf': 'application/pdf', '.ts': 'text/plain; charset=utf-8', '.tsx': 'text/plain; charset=utf-8',
  '.py': 'text/plain; charset=utf-8', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
export const mimeOf = (p: string) => MIME[(p.match(/\.[^./\\]+$/)?.[0] || '').toLowerCase()] || 'application/octet-stream';
