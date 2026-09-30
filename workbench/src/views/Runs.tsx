// 运行：模型工作区的每次运行（准备 → 计时 → 完成 → 登记 → 评分 → 评审），以及从其他电脑导入、没有本地工作区的已登记运行。
import { useEffect, useMemo, useState } from 'react';
import { CircleCheck, CirclePlay, ClipboardList, Copy, FolderOpen, MonitorPlay, Play, Plus, RefreshCw, Search, Square, TimerReset, TriangleAlert } from 'lucide-react';
import type { ItemScore, SpecItem, StoreRun, Usage, WorkspaceRun } from '../../shared/types';
import { get, post } from '../api';
import { useWb } from '../state';
import { go, href, useRoute } from '../lib/router';
import { cls, copyText, fmt, METHOD_LABEL, TIER_LABEL, wsStatus } from '../lib/format';
import { Markdown } from '../lib/markdown';
import { Badge, Btn, Card, CopyBtn, Empty, Field, Kv, Meter, Seg, Tabs } from '../ui/kit';
import { toast } from '../ui/toast';
import { DimChip, NewRunModal, Score, TaskLabel, WsBadge, useNamer } from '../components/common';
import { FileBrowser } from '../components/Files';
import { ItemScorer } from '../components/ItemScorer';

interface Row { key: string; ws?: WorkspaceRun; run?: StoreRun }

export default function Runs() {
  const wb = useWb();
  const route = useRoute();
  const nm = useNamer();
  const [q, setQ] = useState('');
  const [newRun, setNewRun] = useState(false);
  const fModel = route.query.get('model') || '';
  const fTask = route.query.get('task') || '';
  const fStatus = route.query.get('status') || '';
  const fUsage = route.query.get('usage') || '';
  const fFlag = route.query.get('flag') || '';
  const setF = (k: string, v: string) => {
    const qd: Record<string, string> = { model: fModel, task: fTask, status: fStatus, usage: fUsage, flag: fFlag, id: route.query.get('id') || '' };
    qd[k] = v;
    go('runs', route.parts, qd, true);
  };
  const store = wb.store;
  const rows = useMemo<Row[]>(() => {
    if (!store) return [];
    const byId = new Map(store.runs.map((r) => [r.run_id, r]));
    const used = new Set<string>();
    const out: Row[] = store.workspaces.map((w) => {
      const run = w.grader_run_id ? byId.get(w.grader_run_id) : store.runs.find((r) => r.ws_ref === w.ref);
      if (run) used.add(run.run_id);
      return { key: w.ref, ws: w, run };
    });
    for (const r of store.runs) if (!used.has(r.run_id)) out.push({ key: 'run:' + r.run_id, run: r });
    return out;
  }, [store]);
  const status = (r: Row) => (r.ws ? (r.run?.graded ? 'graded' : r.run ? 'registered' : wsStatus(r.ws)) : r.run?.graded ? 'graded' : 'registered');
  const filtered = rows.filter((r) => {
    const model = r.ws ? `${r.ws.vendor}/${r.ws.model}` : `${r.run!.vendor || ''}/${r.run!.model}`;
    const tkey = r.ws?.tkey || r.run!.tkey;
    if (fModel && model !== fModel) return false;
    if (fTask && tkey !== fTask && tkey.slice(0, 3) !== fTask) return false;
    if (fStatus && status(r) !== fStatus) return false;
    if (fUsage === 'missing' && !(r.run && (r.run.usage.missing || []).length)) return false;
    if (fFlag === 'low' && !r.run?.score?.low_confidence) return false;
    if (q && !`${r.key} ${r.run?.run_id || ''} ${r.ws?.harness || r.run?.harness || ''}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });
  const selKey = route.parts.length ? route.parts.join('/') : route.query.get('id') ? 'run:' + route.query.get('id') : '';
  const cur = rows.find((r) => r.key === selKey || (route.query.get('id') && r.run?.run_id === route.query.get('id')));
  const models = [...new Set(rows.map((r) => (r.ws ? `${r.ws.vendor}/${r.ws.model}` : `${r.run!.vendor || ''}/${r.run!.model}`)))];
  const counts = { all: rows.length, prepared: 0, running: 0, finished: 0, registered: 0, graded: 0 } as Record<string, number>;
  for (const r of rows) counts[status(r)] = (counts[status(r)] || 0) + 1;
  const ungradedIds = rows.filter((r) => r.run && !r.run.graded).map((r) => r.run!.run_id);

  return (
    <div className="page page-split wide-side">
      <aside className="side-list">
        <div className="side-h">
          <div className="search-in"><Search size={14} /><input placeholder="搜索 ref / 运行 id / harness" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <Btn size="sm" tone="primary" icon={<Plus size={14} />} onClick={() => setNewRun(true)} disabled={!store?.models.length}>新建</Btn>
        </div>
        <div className="side-filters">
          <select value={fModel} onChange={(e) => setF('model', e.target.value)} aria-label="模型"><option value="">全部模型</option>{models.map((m) => <option key={m} value={m}>{nm.blind ? nm.model(m.split('/')[0], m.split('/')[1]) : m}</option>)}</select>
          <select value={fTask} onChange={(e) => setF('task', e.target.value)} aria-label="题目"><option value="">全部题目</option>{(wb.spec?.tasks || []).map((t) => <option key={t.id} value={t.id}>{t.id} {t.name}</option>)}</select>
        </div>
        <div className="side-filters">
          <Seg size="xs" value={fStatus} onChange={(v) => setF('status', v)} options={[
            { value: '', label: `全部 ${counts.all}` }, { value: 'running', label: `进行 ${counts.running || 0}` }, { value: 'finished', label: `待登记 ${counts.finished || 0}` },
            { value: 'registered', label: `待评分 ${counts.registered || 0}` }, { value: 'graded', label: `已评 ${counts.graded || 0}` },
          ]} />
        </div>
        {(fUsage || fFlag) && <div className="side-filters"><Badge tone="warn">{fUsage ? '缺用量' : '低可信'}</Badge><button className="link xs" onClick={() => go('runs', route.parts, {}, true)}>清除</button></div>}
        {ungradedIds.length > 0 && <div className="side-filters"><Btn size="xs" tone="ghost" icon={<RefreshCw size={12} />} onClick={() => void wb.runJob({ kind: 'grade', runs: ungradedIds }, `评分 ${ungradedIds.length} 次运行`)}>评分全部 {ungradedIds.length} 次未评分运行</Btn></div>}
        <div className="side-scroll">
          {!filtered.length && <p className="muted small pad">没有匹配的运行</p>}
          {filtered.map((r) => {
            const tkey = r.ws?.tkey || r.run!.tkey;
            return (
              <a key={r.key} className={cls('run-i', cur?.key === r.key && 'on')} href={r.ws ? href('runs', [r.ws.ref]) : href('runs', [], { id: r.run!.run_id })}>
                <div className="run-i-t">
                  <span className="mono tid">{tkey}</span>
                  <span className="grow ellipsis">{r.ws ? nm.model(r.ws.vendor, r.ws.model) : nm.blind ? nm.run(r.run!) : r.run!.model}</span>
                  {r.run?.score ? <Score v={r.run.score.total} /> : null}
                </div>
                <div className="run-i-s">
                  <span className="mono muted">{r.ws ? `r${r.ws.index}` : r.run!.alias || ''}</span>
                  <span className="muted ellipsis grow">{r.ws?.harness || r.run?.harness}</span>
                  {r.ws ? <WsBadge w={{ ...r.ws, status: status(r) as WorkspaceRun['status'] }} /> : <Badge tone="accent">仅存储</Badge>}
                </div>
              </a>
            );
          })}
        </div>
      </aside>
      <div className="side-main">
        {cur ? <RunDetail row={cur} key={cur.key} /> : (
          <Empty icon={<ClipboardList size={30} />} title="选择一次运行" action={<Btn tone="primary" icon={<Play size={14} />} onClick={() => setNewRun(true)} disabled={!store?.models.length}>新建运行</Btn>}>
            新建运行会在 <code>model/&lt;供应商&gt;/&lt;模型&gt;/&lt;题号&gt;/rN/</code> 创建干净工作目录，复制预置素材并保存提示词。
          </Empty>
        )}
      </div>
      {newRun && <NewRunModal open onClose={() => setNewRun(false)} preset={fModel ? { vendor: fModel.split('/')[0], model: fModel.split('/')[1], task: fTask.slice(0, 3) || undefined } : undefined} />}
    </div>
  );
}

type DTab = 'score' | 'prompt' | 'final' | 'files' | 'usage' | 'raw';

function RunDetail({ row }: { row: Row }) {
  const wb = useWb();
  const nm = useNamer();
  const { ws, run } = row;
  const task = wb.spec?.tasks.find((t) => t.id === (ws?.task || run?.task));
  const [tab, setTab] = useState<DTab>(run?.score ? 'score' : ws && !ws.ended_at ? 'prompt' : 'final');
  const [texts, setTexts] = useState<{ text: string; prompt: string } | null>(null);
  const [detail, setDetail] = useState<{ metrics: any; final_message: string | null; local: boolean } | null>(null);
  const [, tick] = useState(0);
  useEffect(() => { if (ws) get<{ text: string; prompt: string }>('/api/ws/final', { ref: ws.ref }).then(setTexts, () => setTexts({ text: '', prompt: '' })); }, [ws?.ref, ws?.ended_at]); // eslint-disable-line
  useEffect(() => { if (run) get<{ metrics: any; final_message: string | null; local: boolean }>(`/api/runs/${encodeURIComponent(run.run_id)}`).then(setDetail, () => setDetail(null)); }, [run?.run_id, run?.synced_at]); // eslint-disable-line
  const running = ws && ws.started_at && !ws.ended_at;
  useEffect(() => { if (!running) return; const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, [running]);

  const elapsed = ws?.started_at ? (ws.ended_at ? Date.parse(ws.ended_at) : Date.now()) - Date.parse(ws.started_at) : 0;
  const limitMs = (task?.time_limit || 0) * 60000;
  const stage = run?.graded ? 5 : run ? 4 : ws?.ended_at ? 3 : ws?.started_at ? 2 : 1;
  const openPreview = () => go('stage', [], { open: ws ? 'ws:' + ws.ref : 'run:' + run!.run_id });
  const title = ws ? nm.ref(ws.ref) : nm.run(run!);

  const act = async (fn: () => Promise<unknown>, ok?: string) => { try { await fn(); if (ok) toast.ok(ok); await wb.refresh(['store']); } catch (e: any) { toast.error(e.message); } };

  return (
    <div className="stack">
      <div className="detail-h">
        <div className="grow">
          <div className="row gap-s wrap"><TaskLabel task={ws?.task || run!.task} variant={ws?.variant || run?.variant} />{ws ? <WsBadge w={{ ...ws, status: run?.graded ? 'graded' : run ? 'registered' : undefined }} /> : <Badge tone="accent">仅存储文件（无本地工作区）</Badge>}</div>
          <h2 className="mono">{title}</h2>
          <div className="muted small row gap-s wrap">
            <span>{ws?.harness || run?.harness || '未填写 harness'}</span>
            {run && !nm.blind && <span className="mono">运行 id {run.run_id}</span>}
            {run?.alias && <span className="mono">盲评代号 {run.alias}</span>}
            {ws?.created_at && <span>创建于 {fmt.time(ws.created_at)}</span>}
          </div>
        </div>
        <div className="row gap-s wrap">
          <Btn icon={<MonitorPlay size={14} />} onClick={openPreview}>预览产物</Btn>
          {ws && <Btn icon={<FolderOpen size={14} />} onClick={() => void post('/api/open-folder', { ref: ws.ref }).catch((e) => toast.error(e.message))}>工作目录</Btn>}
          {ws && <Btn icon={<Copy size={14} />} onClick={async () => { const p = texts?.prompt || ''; if (p && await copyText(p)) toast.ok('提示词已复制'); }}>复制提示词</Btn>}
        </div>
      </div>

      {ws && (
        <ol className="stepper">
          {['准备', '运行中', '完成', '登记', '评分'].map((s, i) => <li key={s} className={cls(stage > i + 1 && 'done', stage === i + 1 && 'cur')}><i>{stage > i + 1 ? '✓' : i + 1}</i>{s}</li>)}
        </ol>
      )}

      {ws && stage <= 3 && (
        <Card className="action-card">
          {stage === 1 && (
            <div className="action-row">
              <div className="grow">
                <b>工作目录已就绪</b>
                <div className="muted small">在 {ws.harness || 'Agent 软件'} 中把工作目录设为 <code className="sel">{ws.workspace}</code>，发送提示词的同时点“开始计时”。</div>
              </div>
              <CopyBtn text={() => texts?.prompt || ''} label="复制提示词" />
              <Btn tone="primary" icon={<CirclePlay size={15} />} onClick={() => void act(() => post('/api/ws/start', { ref: ws.ref }), '已开始计时')}>开始计时</Btn>
            </div>
          )}
          {stage === 2 && (
            <div className="action-row">
              <div className="timer">
                <span className={cls('clock big', limitMs > 0 && elapsed > limitMs && 'bad')}>{fmt.clock(elapsed)}</span>
                {limitMs > 0 && <><Meter value={elapsed} max={limitMs} tone={elapsed > limitMs ? 'bad' : elapsed > limitMs * 0.8 ? 'warn' : 'accent'} w={180} /><span className="muted small">上限 {task!.time_limit} 分钟</span></>}
              </div>
              <div className="grow" />
              <Btn icon={<TimerReset size={14} />} tone="ghost" onClick={() => void act(() => post('/api/ws/patch', { ref: ws.ref, started_at: null }), '已重置')}>重置</Btn>
              <Btn tone="primary" icon={<Square size={14} />} onClick={() => void act(() => post('/api/ws/finish', { ref: ws.ref, timed_out: limitMs > 0 && elapsed > limitMs }), '已结束计时')}>结束</Btn>
            </div>
          )}
          {stage === 3 && <FinishForm ws={ws} finalText={texts?.text || ''} onDone={() => void wb.refresh(['store'])} />}
        </Card>
      )}
      {ws && stage === 4 && !run?.graded && (
        <Card className="action-card"><div className="action-row"><div className="grow"><b>已登记，等待自动评分</b><div className="muted small">评分会运行隐藏测试、浏览器探针、ffprobe 等，可能需要几分钟。</div></div>
          <Btn tone="ghost" onClick={() => void wb.runJob({ kind: 'grade', runs: [run!.run_id], fast: true }, '快速评分')}>快速评分（跳过慢探针）</Btn>
          <Btn tone="primary" onClick={() => void wb.runJob({ kind: 'grade', runs: [run!.run_id] }, '评分')}>开始评分</Btn></div></Card>
      )}

      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'score', label: '得分', count: run?.score?.pending.length || undefined, tone: 'warn' },
        ...(ws ? [{ value: 'prompt' as DTab, label: '提示词' }] : []),
        { value: 'final', label: '最后回复' },
        { value: 'files', label: '文件' },
        { value: 'usage', label: '用时与成本' },
        { value: 'raw', label: '原始数据' },
      ]} />
      {tab === 'score' && (run?.score ? <ScorePanel run={run} items={task?.items || []} /> : <Empty title={run ? '尚未评分' : '尚未登记'}>{run ? '点击上方“开始评分”，或在任务页查看评分进度。' : '完成运行并登记到 bench-grader 后即可评分。'}</Empty>)}
      {tab === 'prompt' && ws && (texts ? <div className="stack"><div className="row gap-s"><CopyBtn text={texts.prompt} label="复制提示词" /><span className="muted small">留档于 <code>{ws.ref}.prompt.md</code></span></div><pre className="prompt">{texts.prompt || '（没有找到提示词留档）'}</pre></div> : null)}
      {tab === 'final' && <FinalPanel text={ws ? texts?.text || detail?.final_message || '' : detail?.final_message || ''} ws={ws} />}
      {tab === 'files' && (
        <div className="stack">
          {ws && <FileBrowser root={`model/${ws.ref}`} title={`r${ws.index}（工作目录）`} />}
          {run && detail?.local && <FileBrowser root={run.dir} title="bench-grader 运行目录（交付物副本 + 评分证据）" height={380} />}
        </div>
      )}
      {tab === 'usage' && <UsagePanel ws={ws} run={run} />}
      {tab === 'raw' && <pre className="code">{JSON.stringify({ workspace: ws, run, metrics: detail?.metrics }, null, 2)}</pre>}
    </div>
  );
}

function FinishForm({ ws, finalText, onDone }: { ws: WorkspaceRun; finalText: string; onDone: () => void }) {
  const wb = useWb();
  const [final, setFinal] = useState(finalText);
  const [u, setU] = useState<Partial<Usage>>(ws.usage || {});
  const [timedOut, setTimedOut] = useState(!!ws.timed_out);
  const [harness, setHarness] = useState(ws.harness);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (finalText && !final) setFinal(finalText); }, [finalText]); // eslint-disable-line
  const num = (k: keyof Usage) => (e: { target: { value: string } }) => setU({ ...u, [k]: e.target.value === '' ? undefined : Number(e.target.value) });
  const wall = ws.started_at && ws.ended_at ? (Date.parse(ws.ended_at) - Date.parse(ws.started_at)) / 60000 : null;
  const submit = async (register: boolean, grade = true) => {
    setBusy(true);
    try {
      const clean = Object.fromEntries(Object.entries(u).filter(([, v]) => v !== undefined && v !== null && !Number.isNaN(v)));
      if (harness !== ws.harness) await post('/api/ws/patch', { ref: ws.ref, harness });
      const r = await post<{ job: unknown }>('/api/ws/finish', { ref: ws.ref, at: ws.ended_at, final_message: final, usage: clean, timed_out: timedOut, register, grade });
      toast.ok(register ? '已提交登记' + (grade ? '，登记完成后自动评分' : '') : '已保存');
      if (r.job) void wb.refresh(['jobs']);
      onDone();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="stack">
      <div className="row gap-s"><CircleCheck size={16} className="ok" /><b>运行已结束</b><span className="muted small">墙钟 {fmt.min(wall)}。粘贴模型最后一条回复（用于核对汇报是否属实），补充用量后登记。</span></div>
      <Field label="模型最后一条回复（final_message）" hint="也可以直接在工作区同级保存为 rN.final.md">
        <textarea rows={7} value={final} onChange={(e) => setFinal(e.target.value)} placeholder="粘贴 Agent 的最终汇报…" />
      </Field>
      <div className="form-grid g4">
        <Field label="Harness"><input list="wb-harness" value={harness} onChange={(e) => setHarness(e.target.value)} /></Field>
        <Field label="墙钟（分）" hint={wall ? `计时 ${wall.toFixed(1)}` : '留空按计时或日志'}><input type="number" step="0.1" value={u.wall_min ?? ''} onChange={num('wall_min')} placeholder={wall ? wall.toFixed(1) : ''} /></Field>
        <Field label="有效时间（分）" hint="扣除等人回复"><input type="number" step="0.1" value={u.active_min ?? ''} onChange={num('active_min')} /></Field>
        <Field label="费用（美元）" hint="留空按 token × 单价估算"><input type="number" step="0.001" value={u.cost_usd ?? ''} onChange={num('cost_usd')} /></Field>
        <Field label="输入 token"><input type="number" value={u.input_tokens ?? ''} onChange={num('input_tokens')} /></Field>
        <Field label="输出 token"><input type="number" value={u.output_tokens ?? ''} onChange={num('output_tokens')} /></Field>
        <Field label="缓存读 token"><input type="number" value={u.cache_read_tokens ?? ''} onChange={num('cache_read_tokens')} /></Field>
        <Field label="缓存写 token"><input type="number" value={u.cache_write_tokens ?? ''} onChange={num('cache_write_tokens')} /></Field>
      </div>
      <label className="check"><input type="checkbox" checked={timedOut} onChange={(e) => setTimedOut(e.target.checked)} /> 超出时间上限（记为超时）</label>
      {!ws.has_deliverable && <div className="alert warn"><TriangleAlert size={15} />交付目录 <code>{ws.deliverable_dir}/</code> 还不存在：登记会失败，请确认模型产出位置。</div>}
      <div className="row gap-s">
        <Btn tone="ghost" busy={busy} onClick={() => void submit(false)}>仅保存</Btn>
        <Btn busy={busy} onClick={() => void submit(true, false)}>登记（不评分）</Btn>
        <Btn tone="primary" busy={busy} onClick={() => void submit(true, true)}>登记并自动评分</Btn>
      </div>
    </div>
  );
}

function ScorePanel({ run, items }: { run: StoreRun; items: SpecItem[] }) {
  const wb = useWb();
  const s = run.score!;
  const [filter, setFilter] = useState<'all' | 'pending' | 'manual' | 'low'>(s.pending.length ? 'pending' : 'all');
  const specOf = (id: string) => items.find((i) => i.id === id);
  const rows = s.items.filter((i) => filter === 'all' || (filter === 'pending' && i.status === 'pending') || (filter === 'manual' && i.method !== 'auto') || (filter === 'low' && i.s != null && i.s < 0.5));
  return (
    <div className="stack">
      <div className="score-head">
        <div className="score-total"><Score v={s.total} big /><span className="muted small">单次总分</span></div>
        <div className="grow">
          <div className="row gap-s wrap">
            {s.gate_pass ? <Badge tone="ok" dot>门槛通过</Badge> : <Badge tone="bad" dot>门槛未过（记 0 分）</Badge>}
            {s.passed ? <Badge tone="ok">达标</Badge> : <Badge tone="warn">未达标（&lt; {wb.spec?.cfg.pass_threshold}）</Badge>}
            {!s.complete && <Badge tone="warn">待评 {s.pending.length} 项</Badge>}
            {s.low_confidence && <Badge tone="muted">低可信 · N/A {fmt.pct(s.na_ratio)}</Badge>}
          </div>
          {!s.gate_pass && <ul className="gate-fail">{s.gate_fail.map((g) => <li key={g.id}><b className="mono">{g.id}</b> {g.desc} <span className="muted">（{String(g.value)}）</span></li>)}</ul>}
          <div className="chips mt-s">{Object.entries(s.dims).filter(([, v]) => v != null).map(([d, v]) => <span key={d} className="chip"><i className="dot" style={{ background: `var(--d-${d})` }} /><DimName id={d} /> <b className="mono">{fmt.n(v)}</b></span>)}</div>
          <div className="chips mt-s">{Object.entries(s.tiers).filter(([, v]) => v != null).map(([t, v]) => <span key={t} className={`chip tier-${t}`}>{TIER_LABEL[t as keyof typeof TIER_LABEL] || t} <b className="mono">{fmt.n(v)}</b></span>)}</div>
        </div>
        <div className="col gap-s">
          <Btn size="sm" icon={<RefreshCw size={13} />} onClick={() => void wb.runJob({ kind: 'grade', runs: [run.run_id] }, '重新评分')}>重新评分</Btn>
          {s.pending.length > 0 && <Btn size="sm" tone="primary" onClick={() => go('review', [], { run: run.run_id })}>去评审</Btn>}
        </div>
      </div>
      <Seg value={filter} onChange={setFilter} options={[{ value: 'all', label: `全部 ${s.items.length}` }, { value: 'pending', label: `待评 ${s.pending.length}` }, { value: 'manual', label: '人工 / Agent' }, { value: 'low', label: '低分项' }]} />
      <Card pad={false}>
        <table className="tbl items">
          <thead><tr><th>编号</th><th>维度</th><th>层级</th><th>方式</th><th className="num">权重</th><th>检查内容</th><th className="num">得分</th></tr></thead>
          <tbody>{rows.map((i) => <ItemRow key={i.id} i={i} spec={specOf(i.id)} run={run} />)}</tbody>
        </table>
      </Card>
    </div>
  );
}
function DimName({ id }: { id: string }) { const { spec } = useWb(); return <>{spec?.dims.find((d) => d.id === id)?.name || id}</>; }

function ItemRow({ i, spec, run }: { i: ItemScore; spec?: SpecItem; run: StoreRun }) {
  const [open, setOpen] = useState(i.status === 'pending' && i.method !== 'auto');
  const manual = i.method !== 'auto';
  return (
    <>
      <tr className={cls(i.status === 'pending' && 'pending', manual && 'clickable')} onClick={() => manual && setOpen(!open)}>
        <td className="mono small">{i.id}</td>
        <td><DimChip id={i.dim} /></td>
        <td className={`tier-${i.tier} small`}>{TIER_LABEL[i.tier]}</td>
        <td className={`m-${i.method} small`}>{METHOD_LABEL[i.method]}</td>
        <td className="num">{i.weight}</td>
        <td className="small">{i.desc}{i.value !== undefined && i.method === 'auto' && <span className="metric">值：{typeof i.value === 'object' ? JSON.stringify(i.value) : String(i.value)}</span>}{i.note && <span className="metric">{i.note}</span>}{i.na_reason && <span className="metric">N/A：{i.na_reason}</span>}</td>
        <td className="num">{i.status === 'scored' ? <span className="mono">{fmt.n(i.s, 2)}</span> : <Badge tone={i.status === 'pending' ? 'warn' : i.status === 'na' ? 'muted' : 'bad'}>{{ pending: '待评', na: 'N/A', missing: '缺失', scored: '' }[i.status]}</Badge>}</td>
      </tr>
      {open && manual && spec && (
        <tr className="sub-row"><td colSpan={7}>
          {spec.evidence && <div className="muted small">依据：{spec.evidence}</div>}
          <ItemScorer runId={run.run_id} item={spec} cur={run.manual[i.id]} by={i.method === 'agent' ? 'human (agent 项复核)' : 'human'} />
        </td></tr>
      )}
    </>
  );
}

function FinalPanel({ text, ws }: { text: string; ws?: WorkspaceRun }) {
  const [raw, setRaw] = useState(false);
  if (!text) return <Empty title="没有最后一条回复">{ws ? `在上方完成表单里粘贴，或保存为 ${ws.ref}.final.md` : '登记时未提供 final_message'}</Empty>;
  return (
    <div className="stack">
      <div className="row gap-s"><Seg value={raw ? 'raw' : 'md'} onChange={(v) => setRaw(v === 'raw')} options={[{ value: 'md', label: '渲染' }, { value: 'raw', label: '原文' }]} /><CopyBtn text={text} /></div>
      {raw ? <pre className="prompt">{text}</pre> : <Card><Markdown text={text} /></Card>}
    </div>
  );
}

function UsagePanel({ ws, run }: { ws?: WorkspaceRun; run?: StoreRun }) {
  const u: Partial<Usage> = run?.usage || ws?.usage || {};
  const wall = ws?.started_at && ws?.ended_at ? (Date.parse(ws.ended_at) - Date.parse(ws.started_at)) / 60000 : null;
  return (
    <div className="stack">
      <Card>
        <Kv rows={[
          ['墙钟时间', fmt.min(u.wall_min ?? wall)],
          ['有效时间', fmt.min(u.active_min)],
          ['费用', <>{fmt.usd(u.cost_usd)}{u.cost_estimated && <Badge tone="muted">按单价估算{u.price_as_of ? ` · ${u.price_as_of}` : ''}</Badge>}</>],
          ['输入 / 输出 token', `${fmt.tokens(u.input_tokens)} / ${fmt.tokens(u.output_tokens)}`],
          ['缓存 读 / 写', `${fmt.tokens(u.cache_read_tokens)} / ${fmt.tokens(u.cache_write_tokens)}`],
          ['来源', u.source || '—'],
          ['匹配到的日志', u.log_files?.length ? u.log_files.join('\n') : '—'],
          ['缺失', u.missing?.length ? <span className="warn">{u.missing.join('、')}</span> : '无'],
          ['计时', ws ? `${fmt.time(ws.started_at)} → ${fmt.time(ws.ended_at)}${ws.timed_out ? '（超时）' : ''}` : run ? `${fmt.time(run.started_at)} → ${fmt.time(run.ended_at)}` : '—'],
        ]} />
      </Card>
      <p className="muted small">优先级：登记时提供的用量 → harness 本地日志（Claude Code / Codex CLI / Gemini CLI，按工作目录与时间窗口匹配）→ token × <code>config/prices.yaml</code> 单价估算。仍缺失的会出现在 <code>review/usage_needed.csv</code>。</p>
    </div>
  );
}
