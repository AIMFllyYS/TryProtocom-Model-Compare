// 模型：按供应商分组的模型卡片；详情页含雷达、逐题得分、运行矩阵与单模型报告。
import { useMemo, useState } from 'react';
import { ArrowRight, Boxes, FileText, FolderOpen, Pencil, Plus, Rocket, Star, Trophy } from 'lucide-react';
import type { ModelProfile, WorkspaceRun } from '../../shared/types';
import { vendorById } from '../../shared/vendors';
import { post } from '../api';
import { useWb } from '../state';
import { go, href, useRoute } from '../lib/router';
import { cls, fmt, splitEntrant, wsStatus } from '../lib/format';
import { Markdown } from '../lib/markdown';
import { Badge, Btn, Card, Empty, Modal, Select, Stat } from '../ui/kit';
import { BrandIcon, HarnessIcon, ModelAvatar } from '../ui/brand';
import { Bars, ChartCard, Radar, seriesColor } from '../ui/charts';
import { toast } from '../ui/toast';
import { Score, useNamer } from '../components/common';
import { AddModelDialog, modelKey } from '../components/pickers';
import { launch } from '../components/LaunchPad';

export default function Models() {
  const route = useRoute();
  if (route.parts.length >= 2) return <ModelDetail vendor={route.parts[0]} name={route.parts.slice(1).join('/')} />;
  return <ModelList />;
}

function useModelStats() {
  const wb = useWb();
  return useMemo(() => {
    const m = new Map<string, { quality: number | null; rank: string | null; tasks: Set<string>; runs: number; last: string | null }>();
    for (const md of wb.store?.models || []) m.set(modelKey(md), { quality: null, rank: null, tasks: new Set(), runs: 0, last: null });
    for (const w of wb.store?.workspaces || []) {
      const s = m.get(`${w.vendor}/${w.model}`);
      if (!s) continue;
      s.runs++;
      if (w.grader_run_id || w.detect?.final || w.ended_at) s.tasks.add(w.task);
      const t = w.ended_at || w.started_at || w.created_at;
      if (t && (!s.last || t > s.last)) s.last = t;
    }
    for (const b of wb.agg?.board || []) {
      const md = wb.store?.models.find((x) => x.name === b.model && (!b.vendor || x.vendor === b.vendor));
      const s = md && m.get(modelKey(md));
      if (s && (s.quality == null || (b.quality || 0) > s.quality)) { s.quality = b.quality; s.rank = b.rank; }
    }
    return m;
  }, [wb.store, wb.agg]);
}

function ModelList() {
  const wb = useWb();
  const [add, setAdd] = useState(false);
  const stats = useModelStats();
  const models = wb.store?.models || [];
  const byVendor = useMemo(() => {
    const g = new Map<string, ModelProfile[]>();
    for (const m of models) g.set(m.vendor, [...(g.get(m.vendor) || []), m]);
    return [...g.entries()];
  }, [models]);
  const nTasks = wb.spec?.tasks.length || 8;
  return (
    <div className="page">
      <div className="page-head">
        <div className="page-head-t">
          <h1 className="page-title">模型</h1>
          <p className="page-sub">每个模型对应 <code>model/&lt;供应商&gt;/&lt;模型&gt;/</code> 工作区。新增时只需输入名称，供应商、目录与推荐 harness 自动识别。</p>
        </div>
        <div className="page-x"><Btn tone="primary" size="lg" icon={<Plus size={16} />} onClick={() => setAdd(true)}>新增模型</Btn></div>
      </div>
      {!models.length ? (
        <Card><Empty icon={<Boxes size={30} />} title="还没有模型" action={<Btn tone="primary" icon={<Plus size={15} />} onClick={() => setAdd(true)}>新增第一个模型</Btn>}>输入例如 <code>GPT-6.1-Sol</code>，工作台会识别为 OpenAI 并创建 <code>model/OpenAI/GPT-6.1-Sol/</code>。</Empty></Card>
      ) : byVendor.map(([vendor, list]) => {
        const vd = vendorById(vendor);
        return (
          <section key={vendor} className="section">
            <div className="section-h"><BrandIcon icon={vd?.icon || null} fallback={vendor} size="sm" /><h2>{vd?.name || vendor}</h2>{vd?.cn && <span className="muted small">{vd.cn}</span>}<span className="badge">{list.length}</span></div>
            <div className="grid g-auto">
              {list.map((m) => {
                const s = stats.get(modelKey(m))!;
                const isCur = wb.current === modelKey(m);
                return (
                  <a key={m.name} className={cls('model-card glass sheen', isCur && 'cur')} href={href('models', [m.vendor, m.name])}>
                    <span className="sheen-l" aria-hidden />
                    <div className="row">
                      <ModelAvatar vendor={m.vendor} model={m.name} size="lg" blind={wb.blind} />
                      <div className="grow">
                        <div className="model-card-n ellipsis">{wb.blind ? '（盲评中）' : m.display || m.name}</div>
                        <div className="row gap-s muted xs"><HarnessIcon name={m.harness} size="xs" /><span className="ellipsis">{m.harness || '未设置 harness'}</span></div>
                      </div>
                      {isCur ? <Badge tone="accent" dot>测评中</Badge> : s.rank ? <Badge>#{s.rank}</Badge> : null}
                    </div>
                    <div className="model-card-q">
                      <div><span className="muted xs">质量分</span><div className="big-num">{s.quality == null ? '—' : fmt.n(s.quality)}</div></div>
                      <div className="grow">
                        <div className="task-dots">{(wb.spec?.tasks || []).map((t) => <i key={t.id} className={cls(s.tasks.has(t.id) && 'on')} title={t.id} />)}</div>
                        <div className="muted xs">{s.tasks.size}/{nTasks} 题有交付 · {s.runs} 次运行{s.last ? ` · ${fmt.ago(s.last)}` : ''}</div>
                      </div>
                      <Btn size="sm" tone="primary" icon={<Rocket size={14} />} onClick={(e) => { e.preventDefault(); e.stopPropagation(); launch(modelKey(m)); }}>开始测评</Btn>
                    </div>
                  </a>
                );
              })}
              <button className={cls('model-card add glass-thin', vendor !== byVendor[byVendor.length - 1][0] && 'hide')} onClick={() => setAdd(true)}><Plus size={22} /><span>新增模型</span></button>
            </div>
          </section>
        );
      })}
      {add && <AddModelDialog onClose={() => setAdd(false)} onSaved={(m) => { go('models', [m.vendor, m.name]); setTimeout(() => launch(modelKey(m)), 60); }} />}
    </div>
  );
}

function ModelDetail({ vendor, name }: { vendor: string; name: string }) {
  const wb = useWb();
  const nm = useNamer();
  const m = wb.store?.models.find((x) => x.vendor === vendor && x.name === name);
  const [edit, setEdit] = useState(false);
  const [report, setReport] = useState<{ markdown: string; file: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const entrants = (wb.agg?.board || []).filter((b) => b.model === name && (!b.vendor || b.vendor === vendor));
  const [ent, setEnt] = useState(entrants[0]?.entrant || '');
  const row = entrants.find((b) => b.entrant === ent) || entrants[0];
  const runs = (wb.store?.workspaces || []).filter((w) => w.vendor === vendor && w.model === name);
  if (!m) return <div className="page"><Empty title="模型不存在" action={<Btn onClick={() => go('models')}>返回模型列表</Btn>}>{vendor}/{name}</Empty></div>;
  const dims = (wb.spec?.dims || []).filter((d) => d.kind === 'quality');
  const tasksRows = (wb.agg?.tasks || []).filter((t) => t.entrant === row?.entrant);
  const isCur = wb.current === modelKey(m);
  const gen = async () => {
    setBusy(true);
    try { setReport(await post<{ markdown: string; file: string }>('/api/models/report', { vendor, name })); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const need = wb.spec?.cfg.runs_per_task || 3;
  return (
    <div className="page">
      <div className="model-hero glass">
        <ModelAvatar vendor={vendor} model={name} size="xl" blind={wb.blind} />
        <div className="grow">
          <div className="eyebrow">{vendorById(vendor)?.name || vendor}{m.family ? ` · ${m.family}` : ''}{m.release ? ` · 发布于 ${m.release}` : ''}</div>
          <h1 className="page-title">{wb.blind ? nm.model(vendor, name) : m.display || m.name}</h1>
          <div className="row gap-s wrap mt-s">
            <span className="chip"><HarnessIcon name={m.harness} size="xs" />{m.harness || '未设置 harness'}</span>
            <span className="chip mono">model/{vendor}/{name}/</span>
            {(m.tags || []).map((t) => <span key={t} className="chip">{t}</span>)}
          </div>
          {m.notes && <p className="dim small mt">{m.notes}</p>}
        </div>
        <div className="stack s" style={{ alignItems: 'flex-end' }}>
          <div className="row gap-s">{isCur ? <Badge tone="accent" size="lg" dot>当前测评模型</Badge> : <Btn icon={<Star size={15} />} onClick={() => wb.setCurrent(modelKey(m))}>设为当前</Btn>}<Btn tone="primary" size="lg" icon={<Rocket size={16} />} onClick={() => launch(modelKey(m))}>开始测评</Btn></div>
          <div className="row gap-s">
            <Btn size="sm" icon={<ArrowRight size={14} />} onClick={() => { wb.setCurrent(modelKey(m)); go('tasks'); }}>题目页</Btn>
            <Btn size="sm" icon={<Pencil size={13} />} onClick={() => setEdit(true)}>编辑</Btn>
            <Btn size="sm" icon={<FolderOpen size={13} />} onClick={() => void post('/api/open-folder', { path: `model/${vendor}/${name}` }).catch((e) => toast.error(e.message))}>目录</Btn>
            <Btn size="sm" icon={<FileText size={13} />} busy={busy} onClick={() => void gen()}>生成报告</Btn>
          </div>
        </div>
      </div>

      <div className="grid g-4 mt-l">
        <Stat label="名次" icon={<Trophy size={13} />} value={row ? `#${row.rank}` : '—'} sub={row ? `${wb.agg?.board.length} 个参赛者中` : '尚无评分结果'} />
        <Stat label="质量总分" value={row ? fmt.n(row.quality) : '—'} sub={row?.ci_low != null ? `95% CI ${fmt.n(row.ci_low)} – ${fmt.n(row.ci_high)}` : row && !row.complete ? '评分不完整' : undefined} tone={row?.quality != null ? (row.quality >= 80 ? 'ok' : row.quality >= 60 ? 'accent' : 'warn') : undefined} />
        <Stat label="达标率" value={row ? fmt.pct(row.pass_rate) : '—'} sub={row ? `${row.runs} 次运行 · ${row.tasks} 道题` : undefined} />
        <Stat label="整套期望成本 / 用时" value={row ? fmt.usd(row.suite_exp_cost_usd) : '—'} sub={row ? `${fmt.min(row.suite_exp_min)} · 成本覆盖 ${row.cost_coverage}` : undefined} />
      </div>

      {entrants.length > 1 && <div className="row gap-s mt"><span className="muted small">harness：</span><Select value={row?.entrant || ''} onChange={setEnt} size="sm" options={entrants.map((b) => ({ value: b.entrant, label: splitEntrant(b.entrant).harness, icon: <HarnessIcon name={splitEntrant(b.entrant).harness} size="xs" /> }))} /></div>}

      <div className="grid g-2 mt-l">
        <ChartCard title="维度雷达" sub="7 个质量维度，0–100" exportName={`${name} 维度雷达`}>
          {row ? <div className="center"><Radar axes={dims.map((d) => ({ id: d.id, label: d.name }))} series={[{ key: row.entrant, label: name, color: vendorById(vendor)?.color || seriesColor(0), values: row.dims }]} /></div> : <Empty title="暂无维度分">完成至少一道题的评分后显示。</Empty>}
        </ChartCard>
        <ChartCard title="逐题得分" sub="均值 ± 标准差" exportName={`${name} 逐题得分`}>
          {tasksRows.length ? <Bars cats={(wb.agg?.tkeys || []).map((k) => ({ id: k, label: k }))} series={[{ key: 'm', label: name, color: vendorById(vendor)?.color || seriesColor(0), values: Object.fromEntries(tasksRows.map((t) => [t.task, t.mean])), err: Object.fromEntries(tasksRows.map((t) => [t.task, t.sd])) }]} /> : <Empty title="暂无逐题得分" />}
        </ChartCard>
      </div>

      <Card title="运行矩阵" sub={`每题 ${need} 次，点击格子进入运行或题目`} className="mt-l">
        <div className="run-matrix">
          {(wb.spec?.tasks || []).flatMap((t) => (Object.keys(t.variants).length ? Object.keys(t.variants) : ['']).map((v) => ({ t, v }))).map(({ t, v }) => {
            const rs = runs.filter((w) => w.task === t.id && (w.variant || '') === v).sort((a, b) => a.index - b.index);
            const tr = tasksRows.find((x) => x.task === t.id + v);
            return (
              <div key={t.id + v} className="rm-row">
                <a className="rm-t" href={href('tasks', [t.id])}><b className="mono">{t.id}{v}</b><span className="ellipsis">{t.name}</span></a>
                <div className="rm-cells">
                  {Array.from({ length: Math.max(need, rs.length) }, (_, i) => {
                    const w: WorkspaceRun | undefined = rs[i];
                    const r = w?.grader_run_id ? wb.store?.runs.find((x) => x.run_id === w.grader_run_id) : undefined;
                    const st = !w ? 'none' : r?.graded ? 'graded' : w.grader_run_id ? 'registered' : wsStatus(w);
                    return w ? <a key={i} href={href('runs', [w.ref])} className={cls('rm-c', `st-${st}`)} title={`${w.ref} · ${st}`}>{r?.score ? Math.round(r.score.total) : `r${w.index}`}</a>
                      : <button key={i} className="rm-c st-none" onClick={() => { wb.setCurrent(modelKey(m)); go('tasks', [t.id]); }} title="去复制提示词">+</button>;
                  })}
                </div>
                <div className="rm-s">{tr ? <Score v={tr.mean} /> : <span className="muted">—</span>}</div>
              </div>
            );
          })}
        </div>
      </Card>

      {edit && <AddModelDialog init={m} onClose={() => setEdit(false)} />}
      <Modal open={!!report} onClose={() => setReport(null)} title="单模型报告" sub={report?.file} width={860}>
        {report && <Markdown text={report.markdown} />}
      </Modal>
    </div>
  );
}
