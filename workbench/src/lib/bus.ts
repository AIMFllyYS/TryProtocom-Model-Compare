// 高频流数据（日志、任务输出）的外部存储：按 key 订阅，避免整棵树重渲染。
// 工作台主界面与桌面宠物共用（宠物不加载 state.tsx 的全局上下文）。
import { useCallback, useSyncExternalStore } from 'react';

type Listener = () => void;
export class Bus {
  private data = new Map<string, unknown[]>();
  private subs = new Map<string, Set<Listener>>();
  private static EMPTY: unknown[] = [];
  get<T>(k: string): T[] { return (this.data.get(k) as T[]) || (Bus.EMPTY as T[]); }
  set(k: string, v: unknown[]) { this.data.set(k, v); this.subs.get(k)?.forEach((f) => f()); }
  append(k: string, items: unknown[], max = 4000, key?: (x: any) => unknown) {
    let cur = this.get<unknown>(k).slice();
    if (key) {
      // 折叠的重复日志以同一 seq 回推：原位替换
      const idx = new Map(cur.map((x, i) => [key(x), i]));
      for (const it of items) {
        const i = idx.get(key(it));
        if (i != null) cur[i] = it; else { idx.set(key(it), cur.length); cur.push(it); }
      }
    } else cur = cur.concat(items);
    if (cur.length > max) cur = cur.slice(cur.length - max);
    this.set(k, cur);
  }
  sub(k: string, f: Listener) {
    let s = this.subs.get(k);
    if (!s) this.subs.set(k, (s = new Set()));
    s.add(f);
    return () => { s!.delete(f); };
  }
}
export const bus = new Bus();
export function useBus<T>(k: string): T[] {
  return useSyncExternalStore(useCallback((f) => bus.sub(k, f), [k]), () => bus.get<T>(k));
}
export const jobKey = (id: string) => 'job:' + id;
