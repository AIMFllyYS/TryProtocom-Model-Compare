// 与本地服务通信：REST（写操作带 x-wb-token）+ SSE 事件流（自动重连）。
import type { SessionInfo, WbEvent } from '../shared/types';

let token = '';
export class ApiError extends Error { constructor(public status: number, msg: string) { super(msg); } }

export async function boot(): Promise<SessionInfo> {
  const r = await fetch('/api/session', { cache: 'no-store' });
  if (!r.ok) throw new ApiError(r.status, `无法连接工作台服务（HTTP ${r.status}）`);
  const s = (await r.json()) as SessionInfo;
  token = s.token;
  return s;
}

type Q = Record<string, string | number | boolean | null | undefined>;
const qs = (q?: Q) => {
  if (!q) return '';
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? '?' + s : '';
};

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; query?: Q; signal?: AbortSignal } = {}): Promise<T> {
  const method = opts.method || (opts.body !== undefined ? 'POST' : 'GET');
  const headers: Record<string, string> = { 'x-wb-token': token };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch(path + qs(opts.query), { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, signal: opts.signal, cache: 'no-store' });
  const text = await r.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) throw new ApiError(r.status, (data && data.error) || `HTTP ${r.status}`);
  return data as T;
}
export const get = <T = unknown>(p: string, query?: Q) => api<T>(p, { query });
export const post = <T = unknown>(p: string, body: unknown = {}) => api<T>(p, { method: 'POST', body });
export const del = <T = unknown>(p: string) => api<T>(p, { method: 'DELETE' });

/** 仓库内文件的原始地址（图片、视频、下载）。 */
export const rawUrl = (rel: string, download = false) => `/api/fs/raw?path=${encodeURIComponent(rel)}${download ? '&download=1' : ''}`;

export type Conn = 'connecting' | 'open' | 'down';
export function connectEvents(onEvent: (e: WbEvent) => void, onConn: (c: Conn) => void): () => void {
  let es: EventSource | null = null;
  let stopped = false;
  let retry = 800;
  let timer: number | undefined;
  const open = () => {
    if (stopped) return;
    onConn('connecting');
    es = new EventSource('/api/events');
    es.onopen = () => { retry = 800; onConn('open'); };
    es.onmessage = (m) => { try { onEvent(JSON.parse(m.data)); } catch { /* 忽略坏包 */ } };
    es.onerror = () => {
      es?.close();
      onConn('down');
      timer = window.setTimeout(open, retry);
      retry = Math.min(retry * 1.7, 8000);
    };
  };
  open();
  return () => { stopped = true; es?.close(); if (timer) clearTimeout(timer); };
}

// ---------- 桌面版（Electron preload 注入） ----------
export interface DesktopBridge {
  version: string;
  openDevTools(webContentsId: number, mode?: 'right' | 'bottom' | 'detach' | 'undocked'): Promise<void>;
  closeDevTools(webContentsId: number): Promise<void>;
  emulate(webContentsId: number, p: { width: number; height: number; mobile: boolean; dpr: number; ua?: string } | null): Promise<void>;
  capture(webContentsId: number): Promise<string>; // data URL
  saveFile(name: string, dataUrl: string): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  toggleFullscreen(): Promise<boolean>;
}
declare global { interface Window { wbDesktop?: DesktopBridge } }
export const desktop = (): DesktopBridge | undefined => window.wbDesktop;
