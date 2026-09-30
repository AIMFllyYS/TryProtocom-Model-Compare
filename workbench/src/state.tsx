// 全局数据层：会话、题库规范、存储文件、汇总、任务、预览会话与进程。SSE 事件驱动增量刷新。
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Aggregate, BenchStore, JobInfo, LogEntry, PreviewSession, ProcInfo, RequestEntry, SessionInfo, SpecData, WbEvent } from '../shared/types';
import type { HarnessInfo } from '../server/harness';
import { boot, connectEvents, get, post, type Conn } from './api';
import { go, normView } from './lib/router';
import { toast } from './ui/toast';
export type { HarnessInfo };

// ---------- 高频流数据（日志、任务输出）的外部存储，避免整棵树重渲染 ----------
type Listener = () => void;
class Bus {
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
export const logKey = (sid: string) => 'log:' + sid;
export const reqKey = (sid: string) => 'req:' + sid;
export const jobKey = (id: string) => 'job:' + id;
export const procKey = (id: string) => 'proc:' + id;
export const navKey = (sid: string) => 'nav:' + sid;
export const perfKey = (sid: string) => 'perf:' + sid;

export async function seedLogs(sid: string) {
  const [logs, reqs] = await Promise.all([
    get<LogEntry[]>(`/api/preview/${sid}/logs`, { since: 0 }).catch(() => []),
    get<RequestEntry[]>(`/api/preview/${sid}/requests`, { since: 0 }).catch(() => []),
  ]);
  bus.set(logKey(sid), logs);
  bus.set(reqKey(sid), reqs);
}

// ---------- 上下文 ----------
export interface Wb {
  session: SessionInfo;
  spec: SpecData | null;
  store: BenchStore | null;
  agg: Aggregate | null;
  jobs: JobInfo[];
  previews: PreviewSession[];
  procs: ProcInfo[];
  conn: Conn;
  refresh: (what?: ('spec' | 'store' | 'agg' | 'jobs' | 'previews' | 'procs' | 'harness')[]) => Promise<void>;
  runJob: (body: Record<string, unknown>, label?: string) => Promise<JobInfo | null>;
  blind: boolean;
  setBlind: (b: boolean) => void;
  harness: HarnessInfo[];
  /** 当前测评模型（“供应商/模型”），题目页复制提示词时默认用它 */
  current: string;
  setCurrent: (key: string) => void;
}
const Ctx = createContext<Wb | null>(null);
export const useWb = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('WbProvider 缺失');
  return c;
};

export function WbProvider({ children, fallback }: { children: ReactNode; fallback: (err: string | null, retry: () => void) => ReactNode }) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [spec, setSpec] = useState<SpecData | null>(null);
  const [store, setStore] = useState<BenchStore | null>(null);
  const [agg, setAgg] = useState<Aggregate | null>(null);
  const [jobs, setJobs] = useState<JobInfo[]>([]);
  const [previews, setPreviews] = useState<PreviewSession[]>([]);
  const [procs, setProcs] = useState<ProcInfo[]>([]);
  const [conn, setConn] = useState<Conn>('connecting');
  const [blind, setBlindS] = useState(() => localStorage.getItem('wb.blind') === '1');
  const setBlind = (b: boolean) => { localStorage.setItem('wb.blind', b ? '1' : '0'); setBlindS(b); };
  const [harness, setHarness] = useState<HarnessInfo[]>([]);
  const [current, setCurrentS] = useState(() => localStorage.getItem('wb.current') || '');
  const setCurrent = useCallback((k: string) => {
    localStorage.setItem('wb.current', k);
    setCurrentS(k);
    void post('/api/settings', { current_model: k }).catch(() => {});
  }, []);
  const storeTimer = useRef<number | undefined>(undefined);

  const refresh = useCallback<Wb['refresh']>(async (what = ['spec', 'store', 'agg', 'jobs', 'previews', 'procs', 'harness']) => {
    const tasks: Promise<unknown>[] = [];
    if (what.includes('spec')) tasks.push(get<SpecData>('/api/spec').then(setSpec));
    if (what.includes('store')) tasks.push(get<BenchStore>('/api/store').then((s) => { setStore(s); if (!localStorage.getItem('wb.current') && s.settings.current_model) setCurrentS(s.settings.current_model); }));
    if (what.includes('agg')) tasks.push(get<Aggregate>('/api/aggregate').then(setAgg));
    if (what.includes('jobs')) tasks.push(get<JobInfo[]>('/api/jobs').then(setJobs));
    if (what.includes('previews')) tasks.push(get<PreviewSession[]>('/api/preview').then(setPreviews));
    if (what.includes('procs')) tasks.push(get<ProcInfo[]>('/api/procs').then(setProcs));
    if (what.includes('harness')) tasks.push(get<HarnessInfo[]>('/api/harness').then(setHarness).catch(() => {}));
    const rs = await Promise.allSettled(tasks);
    const bad = rs.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    if (bad) toast.error('刷新失败：' + (bad.reason?.message || bad.reason));
  }, []);

  const start = useCallback(() => {
    setErr(null);
    boot().then((s) => { setSession(s); return refresh(); }).catch((e) => setErr(e.message || String(e)));
  }, [refresh]);
  useEffect(start, [start]);

  // SSE
  useEffect(() => {
    if (!session) return;
    const onEvent = (e: WbEvent) => {
      switch (e.type) {
        case 'store':
          clearTimeout(storeTimer.current);
          storeTimer.current = window.setTimeout(() => void refresh(['store', 'agg']), 250);
          break;
        case 'job':
          setJobs((js) => {
            const i = js.findIndex((j) => j.id === e.job.id);
            const prev = i >= 0 ? js[i] : null;
            if (prev && prev.status !== e.job.status) {
              if (e.job.status === 'done') toast.ok(`完成：${e.job.title}`, { action: { label: '查看', run: () => go('settings', ['jobs'], { job: e.job.id }) } });
              if (e.job.status === 'failed') toast.error(`失败：${e.job.title}${e.job.error ? ' · ' + e.job.error : ''}`, { action: { label: '查看输出', run: () => go('settings', ['jobs'], { job: e.job.id }) } });
            }
            if (i >= 0) { const c = js.slice(); c[i] = e.job; return c; }
            return [e.job, ...js];
          });
          break;
        case 'job-line': bus.append(jobKey(e.id), [e.line], 6000); break;
        case 'log': bus.append(logKey(e.session), e.entries, 3000, (x: LogEntry) => x.seq); break;
        case 'request': bus.append(reqKey(e.session), e.entries, 1500, (x: RequestEntry) => x.seq); break;
        case 'session':
          setPreviews((ps) => {
            const rest = ps.filter((p) => p.id !== e.id);
            return e.session ? [...rest, e.session].sort((a, b) => a.created_at - b.created_at) : rest;
          });
          break;
        case 'proc':
          setProcs((ps) => { const i = ps.findIndex((p) => p.id === e.proc.id); if (i < 0) return [...ps, e.proc]; const c = ps.slice(); c[i] = e.proc; return c; });
          break;
        case 'proc-line': bus.append(procKey(e.id), [{ line: e.line, stream: e.stream }], 5000); break;
        case 'nav': bus.set(navKey(e.session), [{ url: e.url, title: e.title }]); break;
        case 'ui': handleUi(e.action, e.params); break;
        case 'hello': break;
      }
    };
    return connectEvents(onEvent, (c) => {
      setConn((prev) => {
        if (prev === 'down' && c === 'open') void refresh();
        return c;
      });
    });
  }, [session, refresh]);

  const runJob = useCallback<Wb['runJob']>(async (body, label) => {
    try {
      const j = await post<JobInfo>('/api/jobs', body);
      if (j && j.id !== 'sync') toast.info(`已加入队列：${label || j.title}`);
      else toast.ok('同步完成');
      return j;
    } catch (e: any) { toast.error(e.message); return null; }
  }, []);

  const value = useMemo<Wb | null>(() => session && { session, spec, store, agg, jobs, previews, procs, conn, refresh, runJob, blind, setBlind, harness, current, setCurrent },
    [session, spec, store, agg, jobs, previews, procs, conn, refresh, runJob, blind, harness, current, setCurrent]);
  if (!value) return <>{fallback(err, start)}</>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** CLI → 界面遥控 */
function handleUi(action: string, p: Record<string, unknown>) {
  const s = (k: string) => (p[k] == null ? undefined : String(p[k]));
  switch (action) {
    case 'open': {
      const v = normView(s('view') || 'overview');
      go(v, s('id') ? [s('id')!] : []);
      break;
    }
    case 'preview': go('stage', [], { session: s('session'), url: s('url'), path: s('path'), ref: s('ref') }); break;
    case 'run': go('runs', s('ref') ? [s('ref')!] : [], { id: s('id') }); break;
    case 'compare': go('compare', [], { e: s('entrants') || s('e') }); break;
    case 'review': go('runs', [], { tab: 'review', task: s('task') }); break;
    case 'spec': case 'task': go('tasks', s('task') ? [s('task')!] : []); break;
    case 'docs': go('docs', s('section') ? [s('section')!] : []); break;
    default: toast.info(`收到界面指令：${action}`);
  }
  window.focus();
}
