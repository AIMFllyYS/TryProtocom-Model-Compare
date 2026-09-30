// 基于 hash 的极简路由：#/<view>/<a>/<b>?k=v。可深链、可被 CLI（wb ui …）遥控。
import { useEffect, useState } from 'react';

export type View = 'overview' | 'models' | 'tasks' | 'runs' | 'stage' | 'board' | 'compare' | 'exports' | 'docs' | 'settings';
export const VIEWS: View[] = ['overview', 'models', 'tasks', 'runs', 'stage', 'board', 'compare', 'exports', 'docs', 'settings'];
/** 旧视图名（v1 / CLI 文档）→ 新视图 */
const ALIAS: Record<string, View> = { spec: 'tasks', review: 'runs', jobs: 'settings', system: 'settings', method: 'docs', methodology: 'docs', leaderboard: 'board' };
export const normView = (v: string): View => (VIEWS.includes(v as View) ? (v as View) : ALIAS[v] || 'overview');

export interface Route { view: View; parts: string[]; query: URLSearchParams }

export function parseHash(h = location.hash): Route {
  const raw = h.replace(/^#\/?/, '');
  const [p, q = ''] = raw.split('?');
  const parts = p.split('/').filter(Boolean).map(decodeURIComponent);
  const v = normView(parts.shift() || 'overview');
  return { view: v, parts, query: new URLSearchParams(q) };
}

export function href(view: View, parts: (string | number)[] = [], query?: Record<string, string | number | undefined | null>) {
  let s = '#/' + [view, ...parts.map((x) => encodeURIComponent(String(x)))].join('/');
  if (query) {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v != null && v !== '') u.set(k, String(v));
    const qs = u.toString();
    if (qs) s += '?' + qs;
  }
  return s;
}

export function go(view: View, parts: (string | number)[] = [], query?: Record<string, string | number | undefined | null>, replace = false) {
  const h = href(view, parts, query);
  if (replace) history.replaceState(null, '', h);
  else if (location.hash !== h) location.hash = h;
  if (replace) window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function useRoute(): Route {
  const [r, setR] = useState(() => parseHash());
  useEffect(() => {
    const on = () => setR(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}

/** 本地持久化的 state（UI 偏好） */
export function useLocal<T>(key: string, init: T): [T, (v: T | ((p: T) => T)) => void] {
  const [v, setV] = useState<T>(() => {
    try { const s = localStorage.getItem('wb.' + key); return s ? (JSON.parse(s) as T) : init; } catch { return init; }
  });
  const set = (nv: T | ((p: T) => T)) => setV((p) => {
    const val = typeof nv === 'function' ? (nv as (p: T) => T)(p) : nv;
    try { localStorage.setItem('wb.' + key, JSON.stringify(val)); } catch { /* 配额 */ }
    return val;
  });
  return [v, set];
}
