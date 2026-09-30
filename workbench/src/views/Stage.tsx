// 预览舞台：多窗格并排查看模型产物（HTML / 开发服务器 / 视频 / 外部地址），每个窗格独立设备、缩放与 F12 面板。
import { useEffect, useMemo, useRef, useState } from 'react';
import { Columns2, Grid2x2, MonitorPlay, Plus, Rows2, Square, Server, StopCircle, Link2, Link2Off } from 'lucide-react';
import type { PreviewSession } from '../../shared/types';
import { del, get, post } from '../api';
import { useWb } from '../state';
import { go, useLocal, useRoute } from '../lib/router';
import { cls, isVideo } from '../lib/format';
import { Badge, Btn, Empty, IconBtn, Seg, Select } from '../ui/kit';
import { toast } from '../ui/toast';
import { resolveArtifact } from '../components/artifact';
import { useNamer } from '../components/common';
import { ScoreSheet } from '../components/ScoreSheet';
import { Pane, type PaneState } from '../stage/Pane';
import { OpenDialog } from '../stage/OpenDialog';
import { ProcOutput } from '../stage/DevTools';

type Layout = '1' | 'cols' | 'rows' | 'grid';
const newId = () => Math.random().toString(36).slice(2, 9);

export default function Stage() {
  const wb = useWb();
  const route = useRoute();
  const nm = useNamer();
  const [panes, setPanes] = useLocal<PaneState[]>('stage.panes', []);
  const [layout, setLayout] = useLocal<Layout>('stage.layout', 'cols');
  const [sync, setSync] = useLocal('stage.sync', false);
  const [focus, setFocus] = useState<string | null>(null);
  const [openDlg, setOpenDlg] = useState(false);
  const [showProcs, setShowProcs] = useState(false);
  const [scoreRun, setScoreRun] = useLocal<string | null>('stage.score', null);
  const handled = useRef('');

  const addPane = (p: Omit<PaneState, 'id' | 'device' | 'zoom' | 'rotate' | 'devtools'> & Partial<PaneState>, replaceFocused = false) => {
    const base = panes.find((x) => x.id === focus) || panes[0];
    const np: PaneState = { id: newId(), device: sync && base ? base.device : 'fill', zoom: 'fit', rotate: false, devtools: false, ...p };
    setPanes((ps) => {
      if (replaceFocused && ps.length) return ps.map((x) => (x.id === (focus || ps[0].id) ? { ...np, device: x.device, zoom: x.zoom, devtools: x.devtools } : x));
      return [...ps, np].slice(-4);
    });
    setFocus(np.id);
  };
  const openSession = (s: PreviewSession, replace = false) => addPane({ src: { type: 'session', sid: s.id } }, replace);

  // 深链：?session= / ?path= / ?url= / ?open=ws:<ref>,run:<id>
  useEffect(() => {
    const key = route.query.toString();
    if (!key || handled.current === key) return;
    handled.current = key;
    const q = route.query;
    void (async () => {
      try {
        if (q.get('session')) { const s = wb.previews.find((p) => p.id === q.get('session')) || (await get<PreviewSession>(`/api/preview/${q.get('session')}`)); if (!panes.some((p) => p.src.type === 'session' && p.src.sid === s.id)) openSession(s); else setFocus(panes.find((p) => p.src.type === 'session' && p.src.sid === s.id)!.id); }
        if (q.get('path')) {
          const p = q.get('path')!;
          if (isVideo(p)) addPane({ src: { type: 'video', path: p, label: p.split('/').pop()! } });
          else openSession(await post<PreviewSession>('/api/preview', { path: p }));
        }
        if (q.get('url')) openSession(await post<PreviewSession>('/api/preview', { url: q.get('url') }));
        if (q.get('ref')) await openRef('ws:' + q.get('ref'));
        if (q.get('score')) setScoreRun(q.get('score'));
        if (q.get('open')) {
          const list = q.get('open')!.split(',').filter(Boolean);
          if (list.length > 1) setLayout(list.length > 2 ? 'grid' : 'cols');
          for (const x of list) await openRef(x);
        }
      } catch (e: any) { toast.error(e.message); }
      go('stage', [], undefined, true);
    })();
  }, [route.query.toString()]); // eslint-disable-line

  async function openRef(x: string) {
    const store = wb.store!;
    const ws = x.startsWith('ws:') ? store.workspaces.find((w) => w.ref === x.slice(3)) : undefined;
    const run = x.startsWith('run:') ? store.runs.find((r) => r.run_id === x.slice(4)) : ws?.grader_run_id ? store.runs.find((r) => r.run_id === ws.grader_run_id) : undefined;
    const label = ws ? nm.ref(ws.ref) : run ? nm.run(run) : x;
    const a = resolveArtifact(ws, run, label);
    if (a.kind === 'video') addPane({ src: { type: 'video', path: a.path, label } });
    else if (a.kind === 'static') openSession(await post<PreviewSession>('/api/preview', a.body));
    else toast.warn(`${label}：${a.reason}`);
  }

  const update = (id: string, patch: Partial<PaneState>) => setPanes((ps) => ps.map((p) => {
    if (p.id === id) return { ...p, ...patch };
    if (sync && (patch.device || patch.zoom || patch.rotate !== undefined || patch.custom)) {
      const { device, zoom, rotate, custom } = patch;
      return { ...p, ...(device ? { device } : {}), ...(zoom ? { zoom } : {}), ...(rotate !== undefined ? { rotate } : {}), ...(custom ? { custom } : {}) };
    }
    return p;
  }));
  const close = (id: string) => setPanes((ps) => ps.filter((p) => p.id !== id));
  // 清理引用了已关闭会话的窗格：保留，显示“已关闭”，由用户关闭

  const running = wb.procs.filter((p) => p.status === 'running');
  const shown = layout === '1' ? panes.filter((p) => p.id === (focus || panes[0]?.id)).slice(0, 1) : panes;
  const unusedSessions = wb.previews.filter((s) => !panes.some((p) => p.src.type === 'session' && p.src.sid === s.id));

  return (
    <div className="stage">
      <div className="stage-bar">
        <Btn tone="primary" size="sm" icon={<Plus size={14} />} onClick={() => setOpenDlg(true)}>打开产物</Btn>
        <Seg size="xs" label="布局" value={layout} onChange={setLayout} options={[
          { value: '1', label: <Square size={13} />, title: '单窗格' },
          { value: 'cols', label: <Columns2 size={13} />, title: '左右并排' },
          { value: 'rows', label: <Rows2 size={13} />, title: '上下并排' },
          { value: 'grid', label: <Grid2x2 size={13} />, title: '2×2 网格' },
        ]} />
        <IconBtn label={sync ? '设备/缩放同步：开（改一个窗格，全部跟随）' : '设备/缩放同步：关'} active={sync} onClick={() => setSync(!sync)}>{sync ? <Link2 size={15} /> : <Link2Off size={15} />}</IconBtn>
        <div className="stage-tabs">
          {panes.map((p) => {
            const s = p.src.type === 'session' ? wb.previews.find((x) => x.id === (p.src as { sid: string }).sid) : undefined;
            const label = p.src.type === 'video' ? p.src.label : s?.label || '已关闭';
            return <button key={p.id} className={cls('stage-tab', (focus || panes[0]?.id) === p.id && 'on')} onClick={() => setFocus(p.id)} title={label}>{p.src.type === 'video' ? '▶ ' : ''}<span className="ellipsis">{label}</span>{s && s.counts.error > 0 && <span className="err-badge">{s.counts.error}</span>}</button>;
          })}
        </div>
        <div className="grow" />
        {unusedSessions.length > 0 && (
          <Select size="sm" value="" onChange={(id) => { const s = wb.previews.find((x) => x.id === id); if (s) openSession(s); }} label="已打开的预览会话" placeholder={`会话（${wb.previews.length}）`} place="bottom-end"
            options={unusedSessions.map((s) => ({ value: s.id, label: s.label, desc: s.kind === 'proxy' ? '开发服务器' : s.kind === 'url' ? '外部地址' : '静态' }))} />
        )}
        {!scoreRun && (wb.store?.runs || []).length > 0 && (
          <Select size="sm" value="" onChange={(id) => setScoreRun(id)} label="打开评分面板" placeholder="评分面板" place="bottom-end" searchable
            options={(wb.store?.runs || []).filter((r) => r.score?.items.some((i) => i.method === 'human')).map((r) => ({ value: r.run_id, label: `${r.tkey} · ${nm.blind ? r.alias || '匿名' : r.model}`, desc: r.score?.pending.length ? `待评 ${r.score.pending.length}` : '已完成' }))} />
        )}
        <Btn size="sm" tone={showProcs ? 'primary' : 'default'} icon={<Server size={14} />} onClick={() => setShowProcs(!showProcs)}>开发服务器{running.length ? ` · ${running.length}` : ''}</Btn>
      </div>
      {showProcs && <ProcsPanel onOpen={(s) => openSession(s)} />}
      {!panes.length ? (
        <div className="stage-empty">
          <Empty icon={<MonitorPlay size={34} />} title="预览舞台" action={<Btn tone="primary" icon={<Plus size={15} />} onClick={() => setOpenDlg(true)}>打开产物</Btn>}>
            <p>在同一个地方查看所有模型产出：完整 HTML（含本地资源与脚本）、模型的开发服务器（含热更新）、视频、外部地址。</p>
            <ul className="feature-list">
              <li>设备预设、横竖屏、缩放 / 适应、全屏，最多 4 个窗格并排对比</li>
              <li>类 F12 面板：控制台（执行 JS）、网络、帧率与内存；报错同时供 CLI 读取</li>
              <li>{wb.session.desktop ? '桌面版：原生 Chromium 内核、真实 DevTools、移动端 UA / 触摸模拟、截图' : '需要原生 DevTools 与移动端 UA 模拟时，使用桌面版（Bench Workbench.exe）'}</li>
            </ul>
          </Empty>
        </div>
      ) : (
        <div className={cls('stage-grid', `lay-${layout}`, `n-${shown.length}`)}>
          {shown.map((p) => (
            <Pane key={p.id} pane={p} session={p.src.type === 'session' ? wb.previews.find((s) => s.id === (p.src as { sid: string }).sid) : undefined}
              focused={(focus || panes[0]?.id) === p.id} onFocus={() => setFocus(p.id)} onChange={(patch) => update(p.id, patch)} onClose={() => close(p.id)} dtHeight={shown.length > 2 ? 200 : 280} />
          ))}
        </div>
      )}
      {openDlg && <OpenDialog onClose={() => setOpenDlg(false)} onOpenSession={(s, rep) => openSession(s, rep)} onOpenVideo={(path, label) => addPane({ src: { type: 'video', path, label } })} onOpenRef={(x) => void openRef(x).catch((e) => toast.error(e.message))} />}
      {scoreRun && <ScoreSheet runId={scoreRun} onClose={() => setScoreRun(null)} />}
    </div>
  );
}

function ProcsPanel({ onOpen }: { onOpen: (s: PreviewSession) => void }) {
  const wb = useWb();
  const [sel, setSel] = useState<string | null>(null);
  const procs = useMemo(() => [...wb.procs].sort((a, b) => b.started_at - a.started_at), [wb.procs]);
  const cur = procs.find((p) => p.id === sel) || procs[0];
  if (!procs.length) return <div className="procs-panel muted small pad">没有开发服务器进程。点“打开产物 → 开发服务器”在模型工作区里运行 <code>npm run dev</code> 等命令，地址会自动接入预览。</div>;
  return (
    <div className="procs-panel">
      <div className="procs-list">
        {procs.map((p) => (
          <button key={p.id} className={cls('proc-i', cur?.id === p.id && 'on')} onClick={() => setSel(p.id)}>
            <Badge tone={p.status === 'running' ? 'ok' : p.status === 'failed' ? 'bad' : 'muted'} dot>{p.status === 'running' ? '运行中' : p.status === 'failed' ? `失败 ${p.code}` : '已退出'}</Badge>
            <span className="mono small ellipsis grow">{p.cmd}</span>
            <span className="muted xs ellipsis">{p.cwd.split(/[\\/]/).slice(-3).join('/')}</span>
          </button>
        ))}
      </div>
      {cur && (
        <div className="procs-out">
          <div className="row gap-s">
            <span className="mono small">{cur.url || '等待地址…'}</span>
            <div className="grow" />
            {cur.session_id && <Btn size="xs" onClick={() => { const s = wb.previews.find((x) => x.id === cur.session_id); if (s) onOpen(s); }}>在窗格打开</Btn>}
            {!cur.session_id && cur.url && <Btn size="xs" onClick={() => void post<PreviewSession>('/api/preview', { target: cur.url, label: cur.name }).then(onOpen, (e) => toast.error(e.message))}>接入代理</Btn>}
            {cur.status === 'running' ? <Btn size="xs" tone="danger" icon={<StopCircle size={13} />} onClick={() => void post(`/api/procs/${cur.id}/stop`)}>停止</Btn>
              : <Btn size="xs" tone="ghost" onClick={() => void del(`/api/procs/${cur.id}`).then(() => wb.refresh(['procs']))}>移除</Btn>}
          </div>
          <ProcOutput id={cur.id} height={180} />
        </div>
      )}
    </div>
  );
}
