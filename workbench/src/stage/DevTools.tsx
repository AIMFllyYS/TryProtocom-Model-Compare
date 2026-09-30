// 类 F12 面板：控制台（级别筛选、搜索、折叠重复、堆栈、执行 JS）、网络、性能、开发服务器输出。
import { useEffect, useMemo, useRef, useState } from 'react';
import { Ban, ChevronRight, CircleAlert, Info, Search, TriangleAlert, X } from 'lucide-react';
import type { LogEntry, PreviewSession, RequestEntry } from '../../shared/types';
import { get, post } from '../api';
import { bus, logKey, perfKey, procKey, reqKey, seedLogs, useBus, useWb } from '../state';
import { cls, fmt } from '../lib/format';
import { IconBtn, Switch, Tabs } from '../ui/kit';

type T = 'console' | 'network' | 'perf' | 'server';
const LEVELS = [
  { id: 'error', label: '错误' }, { id: 'warn', label: '警告' }, { id: 'info', label: '信息' }, { id: 'log', label: '日志' }, { id: 'debug', label: '调试' },
  { id: 'network', label: '网络' }, { id: 'system', label: '系统' },
] as const;
type Lv = (typeof LEVELS)[number]['id'];
const lvOf = (e: LogEntry): Lv => (e.level === 'resource' ? 'error' : e.level === 'result' ? 'log' : e.level === 'stdout' || e.level === 'stderr' ? 'system' : (e.level as Lv));

export function DevTools({ session, onEval, onClose, height }: { session: PreviewSession; onEval?: (code: string) => void; onClose?: () => void; height?: number }) {
  const wb = useWb();
  const [tab, setTab] = useState<T>('console');
  const logs = useBus<LogEntry>(logKey(session.id));
  const reqs = useBus<RequestEntry>(reqKey(session.id));
  useEffect(() => { void seedLogs(session.id); }, [session.id]);
  const errs = logs.filter((l) => l.level === 'error' || l.level === 'resource' || (l.level === 'network' && (!l.status || l.status >= 400))).length;
  const warns = logs.filter((l) => l.level === 'warn').length;
  const failed = reqs.filter((r) => !r.status || r.status >= 400).length;
  const proc = session.proc_id ? wb.procs.find((p) => p.id === session.proc_id) : undefined;
  return (
    <div className="devtools" style={{ height }}>
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'console', label: '控制台', count: errs || warns ? `${errs ? errs + ' 错' : ''}${errs && warns ? ' · ' : ''}${warns ? warns + ' 警' : ''}` : undefined, tone: errs ? 'bad' : 'warn' },
        { value: 'network', label: '网络', count: failed ? `${failed} 失败` : reqs.length || undefined, tone: failed ? 'bad' : undefined },
        { value: 'perf', label: '性能' },
        ...(proc ? [{ value: 'server' as T, label: `开发服务器 · ${proc.status === 'running' ? '运行中' : '已退出'}` }] : []),
      ]} extra={onClose && <IconBtn label="关闭面板" size="xs" onClick={onClose}><X size={14} /></IconBtn>} />
      {tab === 'console' && <Console session={session} logs={logs} onEval={onEval} />}
      {tab === 'network' && <Network reqs={reqs} logs={logs} />}
      {tab === 'perf' && <Perf session={session} />}
      {tab === 'server' && proc && <ProcOutput id={proc.id} />}
    </div>
  );
}

function Console({ session, logs, onEval }: { session: PreviewSession; logs: LogEntry[]; onEval?: (code: string) => void }) {
  const [on, setOn] = useState<Set<Lv>>(() => new Set(['error', 'warn', 'info', 'log', 'debug', 'system']));
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [code, setCode] = useState('');
  const hist = useRef<string[]>([]);
  const hi = useRef(-1);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const rows = useMemo(() => logs.filter((l) => on.has(lvOf(l)) && (!q || (l.text + ' ' + (l.url || '')).toLowerCase().includes(q.toLowerCase()))), [logs, on, q]);
  useEffect(() => { const el = box.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [rows.length]);
  const cnt = (id: Lv) => logs.filter((l) => lvOf(l) === id).length;
  const toggle = (id: Lv) => { const s = new Set(on); if (s.has(id)) s.delete(id); else s.add(id); setOn(s); };
  const run = () => {
    const c = code.trim();
    if (!c || !onEval) return;
    hist.current = [c, ...hist.current.filter((x) => x !== c)].slice(0, 50);
    hi.current = -1;
    onEval(c);
    setCode('');
    stick.current = true;
  };
  return (
    <div className="console">
      <div className="dt-bar">
        <IconBtn label="清空" size="xs" onClick={() => void post(`/api/preview/${session.id}/clear`).then(() => void seedLogs(session.id))}><Ban size={13} /></IconBtn>
        <div className="search-in xs"><Search size={12} /><input placeholder="筛选" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="lv-chips">
          {LEVELS.map((l) => <button key={l.id} className={cls('lv-chip', `lv-${l.id}`, on.has(l.id) && 'on')} onClick={() => toggle(l.id)}>{l.label}<span>{cnt(l.id)}</span></button>)}
        </div>
      </div>
      <div className="log-list" ref={box} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30; }}>
        {!rows.length && <div className="muted small pad">{session.inject ? '暂无输出。页面的 console、报错、失败请求会实时出现在这里。' : '外部地址未注入探针：桌面版会通过原生 DevTools 捕获日志；网页版请改用“开发服务器代理”预览。'}</div>}
        {rows.map((l) => {
          const lv = lvOf(l);
          const exp = open.has(l.seq);
          const hasMore = !!l.stack;
          return (
            <div key={l.seq} className={cls('log', `lv-${lv}`, l.src === 'eval' && 'eval', l.level === 'result' && 'result')} onClick={() => hasMore && setOpen((s) => { const n = new Set(s); if (n.has(l.seq)) n.delete(l.seq); else n.add(l.seq); return n; })}>
              <span className="log-ic">{lv === 'error' ? <CircleAlert size={13} /> : lv === 'warn' ? <TriangleAlert size={13} /> : lv === 'info' ? <Info size={13} /> : hasMore ? <ChevronRight size={13} className={exp ? 'rot90' : ''} /> : null}</span>
              {l.count && l.count > 1 && <span className="log-n">{l.count}</span>}
              <span className="log-t">{l.text}{exp && l.stack && <span className="log-stack">{l.stack}</span>}</span>
              {l.url && <span className="log-src" title={l.url}>{shortUrl(l.url)}{l.line ? `:${l.line}` : ''}{l.col ? `:${l.col}` : ''}</span>}
              <span className="log-time">{new Date(l.ts).toLocaleTimeString('zh-CN', { hour12: false })}</span>
            </div>
          );
        })}
      </div>
      {onEval && session.inject && (
        <div className="eval">
          <ChevronRight size={14} className="accent" />
          <textarea rows={1} value={code} placeholder="在页面中执行 JavaScript（Enter 执行，Shift+Enter 换行，↑↓ 历史）" onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run(); }
              else if (e.key === 'ArrowUp' && !code.includes('\n')) { hi.current = Math.min(hist.current.length - 1, hi.current + 1); if (hist.current[hi.current]) setCode(hist.current[hi.current]); }
              else if (e.key === 'ArrowDown' && !code.includes('\n')) { hi.current = Math.max(-1, hi.current - 1); setCode(hi.current >= 0 ? hist.current[hi.current] : ''); }
            }} />
        </div>
      )}
    </div>
  );
}
const shortUrl = (u: string) => { try { const x = new URL(u); return (x.pathname.split('/').pop() || x.host) + x.search.slice(0, 20); } catch { return u.slice(-40); } };

function Network({ reqs, logs }: { reqs: RequestEntry[]; logs: LogEntry[] }) {
  const [onlyFail, setOnlyFail] = useState(false);
  const [q, setQ] = useState('');
  // 服务端记录的请求（静态 / 代理）+ 页面内 fetch/XHR（外部接口等）
  const pageReq: RequestEntry[] = logs.filter((l) => l.level === 'network').map((l) => ({ seq: -l.seq, ts: l.ts, method: l.method || 'GET', url: l.url || '', status: l.status || 0, bytes: 0, ms: l.ms || 0, type: 'fetch', src: 'page' }));
  const serverUrls = new Set(reqs.map((r) => r.url));
  const all = [...reqs, ...pageReq.filter((r) => !serverUrls.has(r.url) && ![...serverUrls].some((s) => r.url.endsWith(s)))].sort((a, b) => a.ts - b.ts);
  const rows = all.filter((r) => (!onlyFail || !r.status || r.status >= 400) && (!q || r.url.toLowerCase().includes(q.toLowerCase())));
  const total = all.reduce((a, r) => a + r.bytes, 0);
  return (
    <div className="network">
      <div className="dt-bar">
        <div className="search-in xs"><Search size={12} /><input placeholder="筛选 URL" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <label className="row gap-s xs"><Switch size="sm" checked={onlyFail} onChange={setOnlyFail} label="仅失败" />仅失败</label>
        <span className="muted xs">{all.length} 个请求 · {fmt.bytes(total)}</span>
      </div>
      <div className="net-list">
        <table className="tbl dense">
          <thead><tr><th>状态</th><th>方法</th><th>地址</th><th>类型</th><th className="num">大小</th><th className="num">耗时</th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={r.seq + ':' + i} className={cls((!r.status || r.status >= 400) && 'bad')}>
              <td className="mono">{r.status || '失败'}</td>
              <td className="mono">{r.method}</td>
              <td className="mono ellipsis url" title={r.url}>{r.url}</td>
              <td className="muted">{r.type}{r.src === 'page' ? ' · 页面' : ''}</td>
              <td className="num">{r.bytes ? fmt.bytes(r.bytes) : '—'}</td>
              <td className="num">{r.ms} ms</td>
            </tr>
          ))}</tbody>
        </table>
        {!rows.length && <div className="muted small pad">暂无请求</div>}
      </div>
    </div>
  );
}

function Perf({ session }: { session: PreviewSession }) {
  const samples = useBus<{ fps: number; mem: number | null; nodes: number; ts: number }>(perfKey(session.id));
  const last = samples[samples.length - 1];
  const spark = (vals: number[], max: number) => {
    if (vals.length < 2) return null;
    const w = 300, h = 44;
    const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - (Math.min(v, max) / max) * h}`).join(' ');
    return <svg viewBox={`0 0 ${w} ${h}`} className="spark" preserveAspectRatio="none"><polyline points={pts} /></svg>;
  };
  return (
    <div className="perf pad">
      {!session.inject ? <p className="muted small">外部地址未注入探针，无法采集帧率。</p> : !last ? <p className="muted small">性能采样已开启，等待页面上报…（页面需处于可见状态）</p> : (
        <div className="perf-grid">
          <div><div className="muted xs">帧率</div><b className={cls('mono', last.fps < 30 ? 'bad' : last.fps < 50 ? 'warn' : 'ok')}>{last.fps} fps</b>{spark(samples.map((s) => s.fps), 120)}</div>
          <div><div className="muted xs">JS 堆</div><b className="mono">{last.mem != null ? last.mem + ' MB' : '—'}</b>{spark(samples.map((s) => s.mem || 0), Math.max(64, ...samples.map((s) => s.mem || 0)))}</div>
          <div><div className="muted xs">DOM 节点</div><b className="mono">{last.nodes}</b>{spark(samples.map((s) => s.nodes), Math.max(100, ...samples.map((s) => s.nodes)))}</div>
        </div>
      )}
    </div>
  );
}

export function ProcOutput({ id, height }: { id: string; height?: number }) {
  const lines = useBus<{ line: string; stream: string }>(procKey(id));
  const box = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (lines.length) return;
    get<{ line: string; stream: string }[]>(`/api/procs/${id}/output`, { from: 0 }).then((arr) => { if (arr?.length) bus.set(procKey(id), arr); }).catch(() => {});
  }, [id]); // eslint-disable-line
  useEffect(() => { const el = box.current; if (el) el.scrollTop = el.scrollHeight; }, [lines.length]);
  return <pre ref={box} className="term" style={{ height }}>{lines.map((l, i) => <span key={i} className={l.stream === 'stderr' ? 'err' : undefined}>{l.line}{'\n'}</span>)}{!lines.length && <span className="muted">（暂无输出）</span>}</pre>;
}
