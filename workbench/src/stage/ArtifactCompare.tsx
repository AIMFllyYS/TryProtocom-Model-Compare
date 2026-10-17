import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2 } from 'lucide-react';
import type { PreviewSession, StoreRun, WorkspaceRun } from '../../shared/types';
import { artifactTaskKeys, bestArtifactRun, workspaceForRun } from '../../shared/artifact-selection';
import { useWb } from '../state';
import { post } from '../api';
import { useNamer, Score } from '../components/common';
import { resolveArtifact } from '../components/artifact';
import { Btn, Empty, Modal, Select, Spinner } from '../ui/kit';
import { Pane, type PaneState } from './Pane';

type SessionCache = Map<string, Promise<PreviewSession>>;

export function ArtifactCompare({ entrants }: { entrants: string[] }) {
  const wb = useWb();
  const nm = useNamer();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [device, setDevice] = useState('fill');
  const cache = useRef<SessionCache>(new Map());
  const tasks = useMemo(() => artifactTaskKeys(wb.spec?.tasks || [], wb.agg?.tkeys || []), [wb.spec, wb.agg?.tkeys]);
  const selection = useMemo(() => tasks.map((task) => ({ task, runs: entrants.slice(0, 2).map((entrant) => bestArtifactRun(wb.store?.runs || [], entrant, task)) })), [tasks, entrants, wb.store?.runs]);
  const title = (key: string) => `${key} · ${wb.spec?.tasks.find((t) => key === t.id || key.startsWith(t.id))?.name || '产物'}`;
  const pair = (task: string, runs: (StoreRun | undefined)[], large = false) => <div className={`artifact-pair${large ? ' enlarged' : ''}`}>
    {entrants.slice(0, 2).map((entrant, i) => <ArtifactTile key={`${entrant}:${runs[i]?.run_id || task}:${device}`} entrant={entrant} task={task} run={runs[i]}
      ws={runs[i] ? workspaceForRun(runs[i]!, wb.store?.workspaces || []) : undefined} device={device} cache={cache.current} suspended={!large && expanded !== null} eager={large} />)}
  </div>;
  const active = selection.find((row) => row.task === expanded);
  return <section className="artifact-comparison mt" aria-label="全部题目产物对比">
    <div className="artifact-compare-tools glass-thin">
      <div className="grow"><b>逐题产物对比</b><p className="muted small">每题展示当前总分最高的一次，同分取较早轮次。滚动浏览全部题目，点击放大可集中测试；离屏预览会释放，返回时重新加载。</p></div>
      <Select label="两侧设备适配" value={device} onChange={setDevice} options={[{ value: 'fill', label: '自适应栏宽' }, { value: 'd1280', label: '桌面尺寸 · 适应' }, { value: 'iphone16', label: '手机尺寸 · 适应' }]} />
    </div>
    <div className="artifact-pair-head">{entrants.slice(0, 2).map((e, i) => <b key={e}>{i === 0 ? '左侧' : '右侧'} · {nm.entrant(e)}</b>)}</div>
    {selection.map(({ task, runs }) => <section className="artifact-task" key={task} aria-label={`${task} 产物对比`}>
      <header><h2>{title(task)}</h2><Btn size="sm" icon={<Maximize2 size={14} />} onClick={() => setExpanded(task)}>放大对比</Btn></header>
      {pair(task, runs)}
    </section>)}
    {active && <Modal open onClose={() => setExpanded(null)} title={title(active.task)} width={1600} className="artifact-compare-modal">{pair(active.task, active.runs, true)}</Modal>}
  </section>;
}

function ArtifactTile({ entrant, task, run, ws, cache, device, suspended, eager }: {
  entrant: string; task: string; run?: StoreRun; ws?: WorkspaceRun; cache: SessionCache; device: string; suspended: boolean; eager: boolean;
}) {
  const wb = useWb();
  const nm = useNamer();
  const root = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(eager);
  const [pane, setPane] = useState<PaneState | null>(null);
  const [session, setSession] = useState<PreviewSession>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [closed, setClosed] = useState(false);
  const loaded = useRef('');
  const label = `${nm.entrant(entrant)} · ${task} · r${run?.run_index ?? '?'}`;
  const artifact = useMemo(() => run ? resolveArtifact(ws, run, label) : null, [ws, run, label]);
  const signature = JSON.stringify(artifact);
  const enabled = near && !suspended && !closed;
  useEffect(() => {
    if (eager) return;
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { rootMargin: '120px 0px' });
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, [eager]);
  useEffect(() => {
    if (!enabled || !artifact || artifact.kind === 'none') return;
    const loadKey = `${signature}:${attempt}:${device}`;
    if (loaded.current === loadKey) return;
    let stale = false;
    setError(''); setPane(null);
    const base = { id: run!.run_id, device, zoom: 'fit' as const, rotate: false, devtools: false };
    if (artifact.kind === 'video') { loaded.current = loadKey; setPane({ ...base, src: { type: 'video', path: artifact.path, label } }); }
    else {
      const key = JSON.stringify(artifact.body);
      if (!cache.has(key)) {
        const pending = post<PreviewSession>('/api/preview', artifact.body);
        cache.set(key, pending);
        void pending.catch(() => { if (cache.get(key) === pending) cache.delete(key); });
      }
      void cache.get(key)!.then((s) => { if (!stale) { loaded.current = loadKey; setSession(s); setPane({ ...base, src: { type: 'session', sid: s.id } }); } }, (e) => { if (!stale) setError(e.message); });
    }
    return () => { stale = true; };
  }, [enabled, signature, attempt, device]); // 评分推送不重载 iframe；快速切换只提交当前请求的结果。
  const retry = () => { if (artifact?.kind === 'static') cache.delete(JSON.stringify(artifact.body)); setClosed(false); setAttempt((v) => v + 1); };
  return <div ref={root} className="artifact-tile">
    <div className="artifact-tile-meta"><span className="ellipsis">{nm.entrant(entrant)}</span>{run && <><span className="muted xs">r{run.run_index ?? '?'}</span><Score v={run.score?.total} />{!run.score?.complete && <span className="muted xs">评分未完成</span>}</>}</div>
    <div className="artifact-tile-body">
      {!run ? <Empty title="暂无已评分样本">{task} 尚无可按分数选择的运行。</Empty>
        : artifact?.kind === 'none' ? <Empty title="产物不可用">{artifact.reason}</Empty>
        : closed ? <Empty title="预览已收起" action={<Btn onClick={retry}>重新打开</Btn>} />
        : !enabled ? <div className="artifact-placeholder muted small">{suspended ? '正在放大查看' : '滚动到此处加载产物'}</div>
        : error ? <Empty title="产物加载失败" action={<Btn onClick={retry}>重试</Btn>}>{error}</Empty>
        : pane ? <Pane pane={pane} session={wb.previews.find((p) => p.id === session?.id) || session} focused={false} onFocus={() => {}}
          onChange={(patch) => setPane((p) => p ? { ...p, ...patch } : p)} onClose={() => setClosed(true)} dtHeight={200} />
        : <div className="artifact-placeholder"><Spinner />正在加载产物…</div>}
    </div>
  </div>;
}
