// 运行：看板（进行中 → 已交付待登记 → 待评分 → 已完成），详情含实时交付清单、登记评分、得分明细、预览打分与 AI 评审提示词。
import { useEffect, useMemo, useState } from 'react';
import { Bot, CircleCheck, CirclePlay, Copy, FileCheck2, FolderOpen, Hourglass, LayoutGrid, List, MonitorPlay, RefreshCw, Sparkles, Square, TimerReset, TriangleAlert, X } from 'lucide-react';
import type { ItemScore, SpecItem, StoreRun, Usage, WorkspaceRun } from '../../shared/types';
import { FINAL_FILE } from '../../shared/deliverables';
import { get, post } from '../api';
import { useWb } from '../state';
import { go, href, useLocal, useRoute } from '../lib/router';
import { cls, copyText, fmt, METHOD_LABEL, TIER_LABEL, wsStatus } from '../lib/format';
import { Markdown } from '../lib/markdown';
import { Badge, Btn, Card, CheckBox, CopyBtn, Empty, Field, Kv, Meter, Seg, Select, Tabs } from '../ui/kit';
import { HarnessIcon, ModelAvatar } from '../ui/brand';
import { toast } from '../ui/toast';
import { DimChip, Score, TaskLabel, WsBadge, useNamer } from '../components/common';
import { HarnessPicker, ModelPicker } from '../components/pickers';
import { FileBrowser } from '../components/Files';
import { ItemScorer } from '../components/ItemScorer';

export interface Row { key: string; ws?: WorkspaceRun; run?: StoreRun }
type Col = 'running' | 'delivered' | 'grading' | 'done';

export function useRows(): Row[] {
  const { store } = useWb();
  return useMemo<Row[]>(() => {
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
}
export const colOf = (r: Row): Col => {
  if (r.run) return r.run.graded && r.run.score?.complete ? 'done' : 'grading';
  const w = r.ws!;
  if (w.detect?.final || w.ended_at) return 'delivered';
  return 'running';
};
const COLS: { id: Col; label: string; icon: typeof Hourglass; hint: string }[] = [
  { id: 'running', label: '进行中', icon: Hourglass, hint: '已复制提示词，等待模型交付' },
  { id: 'delivered', label: '已交付 · 待登记', icon: FileCheck2, hint: '检测到 FINAL_MESSAGE.md 或已结束计时' },
  { id: 'grading', label: '待评分', icon: Sparkles, hint: '自动评分 / Agent / 人工项未完成' },
  { id: 'done', label: '已完成', icon: CircleCheck, hint: '评分完整' },
];

export default function Runs() {
  const route = useRoute();
  const rows = useRows();
  const selKey = route.parts.length ? route.parts.join('/') : route.query.get('id') ? 'run:' + route.query.get('id') : '';
  const cur = rows.find((r) => r.key === selKey || (!!route.query.get('id') && r.run?.run_id === route.query.get('id')));
  if (selKey) return cur ? <RunDetail row={cur} key={cur.key} /> : <div className="page"><Empty title="运行不存在" action={<Btn onClick={() => go('runs')}>返回运行列表</Btn>}>{selKey}</Empty></div>;
  return <RunBoard rows={rows} />;
}

function RunBoard({ rows }: { rows: Row[] }) {
  const wb = useWb();
  const nm = useNamer();
  const [view, setView] = useLocal<'board' | 'list'>('runs.view', 'board');
  const [fModel, setFModel] = useLocal('runs.model', '');
  const [fTask, setFTask] = useLocal('runs.task', '');
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  const list = rows.filter((r) => {
    const m = r.ws ? `${r.ws.vendor}/${r.ws.model}` : `${r.run!.vendor || ''}/${r.run!.model}`;
    return (!fModel || m === fModel) && (!fTask || (r.ws?.task || r.run!.task) === fTask);
  }).sort((a, b) => String(b.ws?.started_at || b.ws?.created_at || b.run?.date || '').localeCompare(String(a.ws?.started_at || a.ws?.created_at || a.run?.date || '')));
  const ungraded = rows.filter((r) => r.run && !r.run.graded).map((r) => r.run!.run_id);
  const toRegister = rows.filter((r) => colOf(r) === 'delivered' && r.ws?.detect && r.ws.detect.done === r.ws.detect.total);
  const pend = wb.agg?.pending;
  const reviewAll = async () => { const r = await get<{ text: string }>('/api/review-prompt'); if (await copyText(r.text)) toast.ok('已复制 AI 评审提示词：粘贴给评分 Agent（例如 DeepSeek Harness）'); };
  const registerAll = async () => {
    for (const r of toRegister) { try { await post('/api/ws/finish', { ref: r.ws!.ref, register: true, grade: true }); } catch (e: any) { toast.error(`${r.ws!.ref}：${e.message}`); } }
    toast.ok(`已提交 ${toRegister.length} 次登记，完成后自动评分`);
    void wb.refresh(['store', 'jobs']);
  };
  return (
    <div className="page">
      <div className="page-head">
        <div className="page-head-t">
          <h1 className="page-title">运行</h1>
          <p className="page-sub">复制提示词即创建运行；工作台每 3 秒扫描工作目录，按交付清单点亮进度，模型写出 <code>{FINAL_FILE}</code> 即自动结束计时。</p>
        </div>
        <div className="page-x">
          {toRegister.length > 0 && <Btn tone="tinted" icon={<FileCheck2 size={15} />} onClick={() => void registerAll()}>登记并评分 {toRegister.length} 次交付</Btn>}
          {ungraded.length > 0 && <Btn icon={<RefreshCw size={14} />} onClick={() => void wb.runJob({ kind: 'grade', runs: ungraded }, `评分 ${ungraded.length} 次运行`)}>自动评分 {ungraded.length}</Btn>}
          <Btn icon={<Bot size={15} />} onClick={() => void reviewAll()} tip="复制给评分 Agent 的提示词：先读 .agents/skills，再用 wb CLI 完成全部 Agent 审查项">AI 评审提示词{pend?.agent ? ` · ${pend.agent}` : ''}</Btn>
        </div>
      </div>
      <div className="toolbar-row">
        <ModelPicker value={fModel} onChange={setFModel} size="sm" placeholder="全部模型" allowAdd={false} />
        {fModel && <Btn size="sm" tone="ghost" icon={<X size={13} />} onClick={() => setFModel('')}>清除</Btn>}
        <Select size="sm" value={fTask} onChange={setFTask} placeholder="全部题目" options={[{ value: '', label: '全部题目' }, ...(wb.spec?.tasks || []).map((t) => ({ value: t.id, label: `${t.id} ${t.name}` }))]} />
        <span className="grow" />
        {pend && <span className="muted small">待人工 {pend.human} · 待 Agent {pend.agent} · 缺用量 {pend.usage_missing}</span>}
        <Seg size="sm" value={view} onChange={setView} options={[{ value: 'board', label: <LayoutGrid size={14} />, title: '看板' }, { value: 'list', label: <List size={14} />, title: '列表' }]} />
      </div>
      {!rows.length ? (
        <Card><Empty icon={<CirclePlay size={30} />} title="还没有运行" action={<Btn tone="primary" onClick={() => go('tasks')}>去题目页复制提示词</Btn>}>在「题目」页选题并点「复制提示词」，工作台会创建 <code>model/&lt;供应商&gt;/&lt;模型&gt;/&lt;题号&gt;/rN/</code> 并开始计时。</Empty></Card>
      ) : view === 'board' ? (
        <div className="kanban">
          {COLS.map((c) => {
            const items = list.filter((r) => colOf(r) === c.id);
            return (
              <div key={c.id} className="kan-col">
                <div className="kan-h"><c.icon size={15} /><b>{c.label}</b><span className="badge">{items.length}</span></div>
                <div className="kan-hint muted xs">{c.hint}</div>
                <div className="kan-list">{items.map((r) => <RunCard key={r.key} r={r} nm={nm} />)}{!items.length && <div className="kan-empty">空</div>}</div>
              </div>
            );
          })}
        </div>
      ) : (
        <Card pad={false}>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>模型</th><th>题目</th><th>次</th><th>状态</th><th>交付</th><th>用时</th><th>harness</th><th className="num">得分</th></tr></thead>
            <tbody>{list.map((r) => {
              const w = r.ws;
              return (
                <tr key={r.key} className="clickable" onClick={() => go('runs', w ? [w.ref] : [], w ? undefined : { id: r.run!.run_id })}>
                  <td><span className="row gap-s"><ModelAvatar vendor={w?.vendor || r.run!.vendor} model={w?.model || r.run!.model} size="xs" blind={nm.blind} />{w ? nm.model(w.vendor, w.model) : nm.blind ? nm.run(r.run!) : r.run!.model}</span></td>
                  <td><TaskLabel task={w?.task || r.run!.task} variant={w?.variant || r.run?.variant} /></td>
                  <td className="mono">{w ? `r${w.index}` : r.run!.run_index ?? ''}</td>
                  <td>{w ? <WsBadge w={{ ...w, status: r.run?.graded ? 'graded' : r.run ? 'registered' : undefined }} /> : <Badge tone="accent">仅存储</Badge>}</td>
                  <td>{w?.detect ? <span className="row gap-s"><Meter value={w.detect.done} max={Math.max(1, w.detect.total)} tone={w.detect.done === w.detect.total ? 'ok' : 'accent'} w={60} /><span className="xs muted">{w.detect.done}/{w.detect.total}</span></span> : '—'}</td>
                  <td className="mono small">{w?.started_at ? fmt.clock((w.ended_at ? Date.parse(w.ended_at) : Date.now()) - Date.parse(w.started_at)) : fmt.min(r.run?.usage.wall_min)}</td>
                  <td className="small">{w?.harness || r.run?.harness}</td>
                  <td className="num">{r.run?.score ? <Score v={r.run.score.total} /> : '—'}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        </Card>
      )}
    </div>
  );
}

function RunCard({ r, nm }: { r: Row; nm: ReturnType<typeof useNamer> }) {
  const wb = useWb();
  const w = r.ws;
  const task = wb.spec?.tasks.find((t) => t.id === (w?.task || r.run?.task));
  const el = w?.started_at ? (w.ended_at ? Date.parse(w.ended_at) : Date.now()) - Date.parse(w.started_at) : 0;
  const lim = (task?.time_limit || 0) * 60000;
  return (
    <a className="run-card glass sheen" href={w ? href('runs', [w.ref]) : href('runs', [], { id: r.run!.run_id })}>
      <span className="sheen-l" aria-hidden />
      <div className="row gap-s">
        <ModelAvatar vendor={w?.vendor || r.run?.vendor} model={w?.model || r.run!.model} size="sm" blind={nm.blind} />
        <div className="grow"><div className="b ellipsis">{w ? nm.model(w.vendor, w.model) : nm.blind ? nm.run(r.run!) : r.run!.model}</div><div className="muted xs ellipsis">{(w?.tkey || r.run!.tkey)} · {task?.name}{w ? ` · r${w.index}` : ''}</div></div>
        {r.run?.score ? <Score v={r.run.score.total} big /> : null}
      </div>
      {w?.detect && colOf(r) !== 'done' && (
        <div className="rc-deliv">
          <div className="rc-checks">{w.detect.checks.filter((c) => !c.optional).map((c) => <i key={c.path} className={cls(c.ok && 'on')} title={c.label} />)}<i className={cls('fin', w.detect.final && 'on')} title={FINAL_FILE} /></div>
          <span className="muted xs">{w.detect.done}/{w.detect.total}{w.detect.final ? ' · 已写回复' : ''}</span>
        </div>
      )}
      <div className="row gap-s rc-foot">
        <HarnessIcon name={w?.harness || r.run?.harness} size="xs" />
        <span className="muted xs ellipsis grow">{w?.harness || r.run?.harness || '—'}</span>
        {w?.started_at && !r.run && <span className={cls('mono xs', lim && el > lim ? 'tone-text-bad' : 'muted')}>{fmt.clock(el)}</span>}
        {r.run?.score && !r.run.score.complete && <Badge tone="warn">待评 {r.run.score.pending.length}</Badge>}
        {r.run && !r.run.graded && <Badge tone="info">待自动评分</Badge>}
      </div>
    </a>
  );
}

type DTab = 'score' | 'deliver' | 'prompt' | 'final' | 'files' | 'usage' | 'raw';

function RunDetail({ row }: { row: Row }) {
  const wb = useWb();
  const nm = useNamer();
  const { ws, run } = row;
  const task = wb.spec?.tasks.find((t) => t.id === (ws?.task || run?.task));
  const col = colOf(row);
  const [tab, setTab] = useState<DTab>(run?.score ? 'score' : 'deliver');
  const [texts, setTexts] = useState<{ text: string; prompt: string } | null>(null);
  const [detail, setDetail] = useState<{ metrics: any; final_message: string | null; local: boolean } | null>(null);
  const [, tick] = useState(0);
  useEffect(() => { if (ws) get<{ text: string; prompt: string }>('/api/ws/final', { ref: ws.ref }).then(setTexts, () => setTexts({ text: '', prompt: '' })); }, [ws?.ref, ws?.ended_at, ws?.has_final]); // eslint-disable-line
  useEffect(() => { if (run) get<{ metrics: any; final_message: string | null; local: boolean }>(`/api/runs/${encodeURIComponent(run.run_id)}`).then(setDetail, () => setDetail(null)); }, [run?.run_id, run?.synced_at]); // eslint-disable-line
  const running = ws && ws.started_at && !ws.ended_at;
  useEffect(() => { if (!running) return; const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, [running]);
  const elapsed = ws?.started_at ? (ws.ended_at ? Date.parse(ws.ended_at) : Date.now()) - Date.parse(ws.started_at) : 0;
  const limitMs = (task?.time_limit || 0) * 60000;
  const stage = run?.graded ? (run.score?.complete ? 6 : 5) : run ? 4 : ws?.ended_at || ws?.detect?.final ? 3 : ws?.started_at ? 2 : 1;
  const act = async (fn: () => Promise<unknown>, ok?: string) => { try { await fn(); if (ok) toast.ok(ok); await wb.refresh(['store']); } catch (e: any) { toast.error(e.message); } };
  const preview = (score = false) => go('stage', [], { open: ws ? 'ws:' + ws.ref : 'run:' + run!.run_id, score: score && run ? run.run_id : undefined });
  const aiPrompt = async () => { const r = await get<{ text: string }>('/api/review-prompt', run ? { run_id: run.run_id } : { ref: ws!.ref }); if (await copyText(r.text)) toast.ok('已复制 AI 评审提示词'); };
  const vendor = ws?.vendor || run?.vendor, model = ws?.model || run!.model;

  return (
    <div className="page">
      <div className="run-hero glass">
        <ModelAvatar vendor={vendor} model={model} size="xl" blind={nm.blind} />
        <div className="grow">
          <div className="row gap-s wrap"><TaskLabel task={ws?.task || run!.task} variant={ws?.variant || run?.variant} />{ws ? <WsBadge w={{ ...ws, status: run?.graded ? 'graded' : run ? 'registered' : undefined }} /> : <Badge tone="accent">仅存储文件</Badge>}{run?.score?.low_confidence && <Badge>低可信</Badge>}</div>
          <h1 className="page-title mt-s">{nm.model(vendor, model)}<span className="muted"> · {ws ? `r${ws.index}` : run?.alias}</span></h1>
          <div className="row gap-s wrap muted small mt-s">
            <span className="row gap-s"><HarnessIcon name={ws?.harness || run?.harness} size="xs" />{ws?.harness || run?.harness || '未填写 harness'}</span>
            {run && !nm.blind && <span className="mono">run {run.run_id}</span>}
            {ws?.created_at && <span>创建于 {fmt.time(ws.created_at)}</span>}
          </div>
        </div>
        {run?.score && <div className="hero-score"><Score v={run.score.total} big /><span className="muted xs">单次总分</span></div>}
      </div>

      {ws && (
        <ol className="stepper">
          {['工作目录', '运行中', '交付', '登记', '自动评分', '复核完成'].map((s, i) => <li key={s} className={cls(stage > i + 1 && 'done', stage === i + 1 && 'cur')}><i>{stage > i + 1 ? '✓' : i + 1}</i><span>{s}</span></li>)}
        </ol>
      )}

      <div className="run-actions">
        <Btn tone={col === 'grading' && run?.graded ? 'primary' : 'default'} icon={<MonitorPlay size={15} />} onClick={() => preview(!!run?.graded)}>{run?.graded ? '预览并打分' : '预览产物'}</Btn>
        {ws && <Btn icon={<FolderOpen size={14} />} onClick={() => void post('/api/open-folder', { ref: ws.ref }).catch((e) => toast.error(e.message))}>工作目录</Btn>}
        {ws && <CopyBtn text={() => texts?.prompt || ''} label="复制提示词" />}
        {(run || ws) && <Btn icon={<Bot size={15} />} onClick={() => void aiPrompt()} tip="复制给评分 Agent 的提示词（skills 路径 + wb CLI 步骤）">AI 评审提示词</Btn>}
        <span className="grow" />
        {run && <Btn size="sm" tone="ghost" icon={<RefreshCw size={13} />} onClick={() => void wb.runJob({ kind: 'grade', runs: [run.run_id] }, '重新评分')}>重新评分</Btn>}
      </div>

      {ws && stage === 1 && (
        <Card className="mt"><div className="action-row"><div className="grow"><b>工作目录已就绪，尚未开始</b><div className="muted small">在 {ws.harness || 'Agent 软件'} 中打开 <code className="sel">{ws.workspace}</code>，粘贴提示词。</div></div>
          <Btn tone="primary" icon={<CirclePlay size={15} />} onClick={() => void act(() => post('/api/ws/start', { ref: ws.ref }), '已开始计时')}>开始计时</Btn></div></Card>
      )}
      {ws && stage === 2 && (
        <Card className="mt"><div className="action-row">
          <div className="timer"><span className={cls('clock', limitMs > 0 && elapsed > limitMs && 'bad')}>{fmt.clock(elapsed)}</span>{limitMs > 0 && <div className="stack s"><Meter value={elapsed} max={limitMs} tone={elapsed > limitMs ? 'bad' : elapsed > limitMs * 0.8 ? 'warn' : 'accent'} w={200} /><span className="muted xs">上限 {task!.time_limit} 分钟</span></div>}</div>
          <div className="grow" />
          <Btn tone="ghost" icon={<TimerReset size={14} />} onClick={() => void act(() => post('/api/ws/patch', { ref: ws.ref, started_at: null }), '已重置计时')}>重置</Btn>
          <Btn icon={<Square size={14} />} onClick={() => void act(() => post('/api/ws/finish', { ref: ws.ref, timed_out: limitMs > 0 && elapsed > limitMs }), '已结束计时')}>手动结束</Btn>
        </div></Card>
      )}
      {ws && stage === 3 && <FinishForm ws={ws} finalText={texts?.text || ''} onDone={() => void wb.refresh(['store', 'jobs'])} />}
      {ws && stage === 4 && (
        <Card className="mt"><div className="action-row"><div className="grow"><b>已登记，等待自动评分</b><div className="muted small">评分会运行隐藏测试、浏览器探针、ffprobe 等，可能需要几分钟。</div></div>
          <Btn tone="ghost" onClick={() => void wb.runJob({ kind: 'grade', runs: [run!.run_id], fast: true }, '快速评分')}>快速评分</Btn>
          <Btn tone="primary" onClick={() => void wb.runJob({ kind: 'grade', runs: [run!.run_id] }, '评分')}>开始评分</Btn></div></Card>
      )}

      <div className="mt-l">
        <Tabs value={tab} onChange={setTab} tabs={[
          { value: 'score', label: '得分', count: run?.score?.pending.length || undefined, tone: 'warn' },
          ...(ws ? [{ value: 'deliver' as DTab, label: '交付检测' }, { value: 'prompt' as DTab, label: '提示词' }] : []),
          { value: 'final', label: '最后回复' }, { value: 'files', label: '文件' }, { value: 'usage', label: '用时与成本' }, { value: 'raw', label: '原始数据' },
        ]} />
        {tab === 'score' && (run?.score ? <ScorePanel run={run} items={task?.items || []} onPreview={() => preview(true)} /> : <Card><Empty title={run ? '尚未评分' : '尚未登记'}>{run ? '点击上方「开始评分」。' : '交付完成后登记到 bench-grader 即可自动评分。'}</Empty></Card>)}
        {tab === 'deliver' && ws && <DeliverPanel ws={ws} />}
        {tab === 'prompt' && ws && (texts ? <Card title="发给模型的提示词" sub={`留档于 ${ws.ref}.prompt.md`} extra={<CopyBtn text={texts.prompt} />}><pre className="prompt">{texts.prompt || '（没有找到提示词留档）'}</pre></Card> : null)}
        {tab === 'final' && <FinalPanel text={ws ? texts?.text || detail?.final_message || '' : detail?.final_message || ''} ws={ws} />}
        {tab === 'files' && <div className="stack">{ws && <FileBrowser root={`model/${ws.ref}`} title={`r${ws.index}（工作目录）`} />}{run && detail?.local && <FileBrowser root={run.dir} title="bench-grader 运行目录（交付物副本 + 评分证据）" height={380} />}</div>}
        {tab === 'usage' && <UsagePanel ws={ws} run={run} />}
        {tab === 'raw' && <pre className="prompt">{JSON.stringify({ workspace: ws, run, metrics: detail?.metrics }, null, 2)}</pre>}
      </div>
    </div>
  );
}

function DeliverPanel({ ws }: { ws: WorkspaceRun }) {
  const d = ws.detect;
  if (!d) return <Card><Empty title="没有交付检测数据" /></Card>;
  return (
    <Card title="交付检测" sub={`每 3 秒扫描 · 最近修改 ${d.last_change ? fmt.ago(d.last_change) : '—'}`} extra={<Badge tone={d.done === d.total ? 'ok' : 'accent'}>{d.done}/{d.total}</Badge>}>
      <div className="deliv">
        <div className={cls('deliv-root mono', d.dir_exists && 'ok')}>{d.dir_exists ? <CircleCheck size={14} /> : <Hourglass size={14} />}{ws.deliverable_dir}/</div>
        {d.checks.map((c) => <div key={c.path} className={cls('deliv-f', c.ok && 'ok', c.optional && 'opt')}>{c.ok ? <CircleCheck size={14} /> : <Hourglass size={14} />}<span className="mono">{c.found || c.label}</span>{c.optional && <Badge>可选</Badge>}</div>)}
        <div className={cls('deliv-f fin', d.final && 'ok')}>{d.final ? <CircleCheck size={14} /> : <Hourglass size={14} />}<span className="mono">{FINAL_FILE}</span><span className="muted xs">{d.final ? '已导入为最后回复' : '模型写出后自动结束计时'}</span></div>
      </div>
      {ws.entry && <p className="muted small mt">预览入口：<code>{ws.entry}</code></p>}
    </Card>
  );
}

function FinishForm({ ws, finalText, onDone }: { ws: WorkspaceRun; finalText: string; onDone: () => void }) {
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
      await post('/api/ws/finish', { ref: ws.ref, at: ws.ended_at, final_message: final, usage: clean, timed_out: timedOut, register, grade });
      toast.ok(register ? '已提交登记' + (grade ? '，完成后自动评分' : '') : '已保存');
      onDone();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const d = ws.detect;
  return (
    <Card className="mt" title={<span className="row gap-s"><CircleCheck size={16} className="tone-text-ok" />{ws.auto_finished ? '模型已交付（自动检测）' : '运行已结束'}</span>} sub={`墙钟 ${fmt.min(wall)}${d ? ` · 交付 ${d.done}/${d.total}` : ''}`}>
      <div className="stack">
        <Field label="模型最后一条回复" hint={ws.auto_finished ? `已从 ${FINAL_FILE} 导入，可修改` : `也可以让模型写入工作目录下的 ${FINAL_FILE}`}>
          <textarea rows={6} value={final} onChange={(e) => setFinal(e.target.value)} placeholder="粘贴 Agent 的最终汇报…" />
        </Field>
        <div className="form-grid">
          <Field label="Harness"><HarnessPicker value={harness} onChange={setHarness} block /></Field>
          <Field label="墙钟（分）" hint={wall ? `计时 ${wall.toFixed(1)}` : '留空按计时或日志'}><input type="number" step="0.1" value={u.wall_min ?? ''} onChange={num('wall_min')} placeholder={wall ? wall.toFixed(1) : ''} /></Field>
          <Field label="有效时间（分）"><input type="number" step="0.1" value={u.active_min ?? ''} onChange={num('active_min')} /></Field>
          <Field label="费用（美元）" hint="留空按 token × 单价估算"><input type="number" step="0.001" value={u.cost_usd ?? ''} onChange={num('cost_usd')} /></Field>
          <Field label="输入 token"><input type="number" value={u.input_tokens ?? ''} onChange={num('input_tokens')} /></Field>
          <Field label="输出 token"><input type="number" value={u.output_tokens ?? ''} onChange={num('output_tokens')} /></Field>
        </div>
        <label className="row gap-s small"><CheckBox checked={timedOut} onChange={setTimedOut} label="超时" />超出时间上限（记为超时）</label>
        {!ws.has_deliverable && <div className="alert warn"><TriangleAlert size={15} />交付目录 <code>{ws.deliverable_dir}/</code> 还不存在：登记会失败。</div>}
        <div className="row gap-s">
          <Btn tone="ghost" busy={busy} onClick={() => void submit(false)}>仅保存</Btn>
          <Btn busy={busy} onClick={() => void submit(true, false)}>登记（不评分）</Btn>
          <Btn tone="primary" busy={busy} onClick={() => void submit(true, true)}>登记并自动评分</Btn>
        </div>
      </div>
    </Card>
  );
}

function ScorePanel({ run, items, onPreview }: { run: StoreRun; items: SpecItem[]; onPreview: () => void }) {
  const wb = useWb();
  const s = run.score!;
  const [filter, setFilter] = useState<'all' | 'pending' | 'manual' | 'low'>(s.pending.length ? 'pending' : 'all');
  const specOf = (id: string) => items.find((i) => i.id === id);
  const rows = s.items.filter((i) => filter === 'all' || (filter === 'pending' && i.status === 'pending') || (filter === 'manual' && i.method !== 'auto') || (filter === 'low' && i.s != null && i.s < 0.5));
  const humanPending = s.items.filter((i) => i.status === 'pending' && i.method === 'human').length;
  return (
    <div className="stack">
      <Card>
        <div className="score-head">
          <div className="score-total"><Score v={s.total} big /><span className="muted xs">单次总分</span></div>
          <div className="grow stack s">
            <div className="row gap-s wrap">
              {s.gate_pass ? <Badge tone="ok" dot>门槛通过</Badge> : <Badge tone="bad" dot>门槛未过（记 0 分）</Badge>}
              {s.passed ? <Badge tone="ok">达标</Badge> : <Badge tone="warn">未达标（&lt; {wb.spec?.cfg.pass_threshold}）</Badge>}
              {!s.complete && <Badge tone="warn">待评 {s.pending.length} 项</Badge>}
              {s.low_confidence && <Badge>低可信 · N/A {fmt.pct(s.na_ratio)}</Badge>}
            </div>
            {!s.gate_pass && <ul className="gates">{s.gate_fail.map((g) => <li key={g.id}><TriangleAlert size={14} /><span><b className="mono">{g.id}</b> {g.desc} <span className="muted">（{String(g.value)}）</span></span></li>)}</ul>}
            <div className="chips">{Object.entries(s.dims).filter(([, v]) => v != null).map(([d, v]) => <span key={d} className="chip"><i className="dot" style={{ background: `var(--d-${d})` }} />{wb.spec?.dims.find((x) => x.id === d)?.name || d} <b className="mono">{fmt.n(v)}</b></span>)}</div>
            <div className="chips">{Object.entries(s.tiers).filter(([, v]) => v != null).map(([t, v]) => <span key={t} className="chip">{TIER_LABEL[t as keyof typeof TIER_LABEL] || t} <b className="mono">{fmt.n(v)}</b></span>)}</div>
          </div>
          {humanPending > 0 && <Btn tone="primary" icon={<MonitorPlay size={15} />} onClick={onPreview}>预览并打 {humanPending} 个人工项</Btn>}
        </div>
      </Card>
      <Seg value={filter} onChange={setFilter} options={[{ value: 'all', label: `全部 ${s.items.length}` }, { value: 'pending', label: `待评 ${s.pending.length}` }, { value: 'manual', label: '人工 / Agent' }, { value: 'low', label: '低分项' }]} />
      <Card pad={false}>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>编号</th><th>维度</th><th>层级</th><th>方式</th><th className="num">权重</th><th>检查内容</th><th className="num">得分</th></tr></thead>
          <tbody>{rows.map((i) => <ItemRow key={i.id} i={i} spec={specOf(i.id)} run={run} />)}</tbody>
        </table></div>
      </Card>
    </div>
  );
}

function ItemRow({ i, spec, run }: { i: ItemScore; spec?: SpecItem; run: StoreRun }) {
  const [open, setOpen] = useState(i.status === 'pending' && i.method === 'human');
  const manual = i.method !== 'auto';
  return (
    <>
      <tr className={cls(manual && 'clickable')} onClick={() => manual && setOpen(!open)}>
        <td className="mono small">{i.id}</td>
        <td><DimChip id={i.dim} /></td>
        <td className="small">{TIER_LABEL[i.tier]}</td>
        <td className="small">{METHOD_LABEL[i.method]}</td>
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
  if (!text) return <Card><Empty title="没有最后一条回复">{ws ? `模型写出 ${FINAL_FILE} 后会自动导入，或在上方表单粘贴。` : '登记时未提供 final_message'}</Empty></Card>;
  return (
    <Card title="最后一条回复" extra={<><Seg size="xs" value={raw ? 'raw' : 'md'} onChange={(v) => setRaw(v === 'raw')} options={[{ value: 'md', label: '渲染' }, { value: 'raw', label: '原文' }]} /><CopyBtn text={text} size="sm" tone="ghost" /></>}>
      {raw ? <pre className="prompt">{text}</pre> : <div className="md"><Markdown text={text} /></div>}
    </Card>
  );
}

function UsagePanel({ ws, run }: { ws?: WorkspaceRun; run?: StoreRun }) {
  const u: Partial<Usage> = run?.usage || ws?.usage || {};
  const wall = ws?.started_at && ws?.ended_at ? (Date.parse(ws.ended_at) - Date.parse(ws.started_at)) / 60000 : null;
  return (
    <Card>
      <Kv rows={[
        ['墙钟时间', fmt.min(u.wall_min ?? wall)], ['有效时间', fmt.min(u.active_min)],
        ['费用', <>{fmt.usd(u.cost_usd)}{u.cost_estimated && <Badge>按单价估算{u.price_as_of ? ` · ${u.price_as_of}` : ''}</Badge>}</>],
        ['输入 / 输出 token', `${fmt.tokens(u.input_tokens)} / ${fmt.tokens(u.output_tokens)}`], ['缓存 读 / 写', `${fmt.tokens(u.cache_read_tokens)} / ${fmt.tokens(u.cache_write_tokens)}`],
        ['来源', u.source || '—'], ['匹配到的日志', u.log_files?.length ? u.log_files.join('\n') : '—'],
        ['缺失', u.missing?.length ? <span className="tone-text-warn">{u.missing.join('、')}</span> : '无'],
        ['计时', ws ? `${fmt.time(ws.started_at)} → ${fmt.time(ws.ended_at)}${ws.timed_out ? '（超时）' : ''}${ws.auto_finished ? ' · 自动结束' : ''}` : run ? `${fmt.time(run.started_at)} → ${fmt.time(run.ended_at)}` : '—'],
      ]} />
      <p className="muted small mt">优先级：登记时提供的用量 → harness 本地日志（Claude Code / Codex CLI / Gemini CLI）→ token × <code>config/prices.yaml</code> 单价估算。</p>
    </Card>
  );
}
