// 模型：按供应商分组的模型档案 + 单个模型的工作区（题目 × 运行）、榜单表现与报告。
import { useMemo, useState } from 'react';
import { Boxes, FileText, FolderOpen, Pencil, Play, Plus, Search } from 'lucide-react';
import type { ModelProfile } from '../../shared/types';
import { post } from '../api';
import { useWb } from '../state';
import { go, href, useRoute } from '../lib/router';
import { cls, colorFor, fmt } from '../lib/format';
import { Markdown } from '../lib/markdown';
import { Badge, Btn, Card, Empty, Modal } from '../ui/kit';
import { Radar } from '../ui/charts';
import { toast } from '../ui/toast';
import { ModelModal, NewRunModal, Score, WsBadge, useNamer } from '../components/common';

export default function Models() {
  const wb = useWb();
  const route = useRoute();
  const nm = useNamer();
  const [q, setQ] = useState('');
  const [add, setAdd] = useState(false);
  const models = wb.store?.models || [];
  const [vendor, name] = route.parts;
  const cur = models.find((m) => m.vendor === vendor && m.name === name) || (!vendor ? models[0] : undefined);
  const groups = useMemo(() => {
    const g = new Map<string, ModelProfile[]>();
    for (const m of models) {
      if (q && !`${m.vendor} ${m.name} ${m.display || ''} ${m.harness || ''} ${(m.tags || []).join(' ')}`.toLowerCase().includes(q.toLowerCase())) continue;
      if (!g.has(m.vendor)) g.set(m.vendor, []);
      g.get(m.vendor)!.push(m);
    }
    return [...g.entries()];
  }, [models, q]);
  const boardOf = (m: ModelProfile) => (wb.agg?.board || []).filter((b) => b.model === m.name && (!b.vendor || b.vendor === m.vendor));

  return (
    <div className="page page-split">
      <aside className="side-list">
        <div className="side-h">
          <div className="search-in"><Search size={14} /><input placeholder="筛选模型" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <Btn size="sm" tone="primary" icon={<Plus size={14} />} onClick={() => setAdd(true)}>新增</Btn>
        </div>
        {!models.length && <p className="muted small pad">工作区目录 <code>model/</code> 下还没有模型。</p>}
        {groups.map(([v, ms]) => (
          <div key={v} className="side-g">
            <div className="side-gh">{nm.blind ? '供应商' : v}<span className="muted">{ms.length}</span></div>
            {ms.map((m) => {
              const b = boardOf(m)[0];
              const n = (wb.store?.workspaces || []).filter((w) => w.vendor === m.vendor && w.model === m.name).length;
              return (
                <a key={m.name} href={href('models', [m.vendor, m.name])} className={cls('side-i', cur === m && 'on')}>
                  <i className="dot" style={{ background: m.color || colorFor(`${m.vendor}/${m.name}`) }} />
                  <span className="grow ellipsis">{nm.blind ? nm.model(m.vendor, m.name) : m.display || m.name}</span>
                  <span className="muted xs">{n} 次</span>
                  {b && <Score v={b.quality} />}
                </a>
              );
            })}
          </div>
        ))}
      </aside>
      <div className="side-main">
        {cur ? <ModelDetail m={cur} key={cur.vendor + '/' + cur.name} /> : <Empty icon={<Boxes size={30} />} title={vendor ? `找不到模型 ${vendor}/${name}` : '选择或新增一个模型'} action={<Btn tone="primary" onClick={() => setAdd(true)}>新增模型</Btn>}>
          每个模型的全部产物都在 <code>model/&lt;供应商&gt;/&lt;模型&gt;/</code>，例如 <code>model/OpenAI/GPT-6.1-Sol/T05/r1/</code>。
        </Empty>}
      </div>
      {add && <ModelModal open onClose={() => setAdd(false)} />}
    </div>
  );
}

function ModelDetail({ m }: { m: ModelProfile }) {
  const wb = useWb();
  const nm = useNamer();
  const [edit, setEdit] = useState(false);
  const [newRun, setNewRun] = useState<{ task?: string; variant?: string } | null>(null);
  const [report, setReport] = useState<{ markdown: string; file: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const spec = wb.spec;
  const ws = (wb.store?.workspaces || []).filter((w) => w.vendor === m.vendor && w.model === m.name);
  const board = (wb.agg?.board || []).filter((b) => b.model === m.name && (!b.vendor || b.vendor === m.vendor));
  const qd = (spec?.dims || []).filter((d) => d.kind === 'quality');
  const tkeys = (spec?.tasks || []).flatMap((t) => (Object.keys(t.variants || {}).length ? Object.keys(t.variants).map((v) => ({ t, v, k: t.id + v })) : [{ t, v: '', k: t.id }]));
  const runOf = (id: string | null) => (id ? wb.store?.runs.find((r) => r.run_id === id) : undefined);
  const color = m.color || colorFor(`${m.vendor}/${m.name}`);
  const genReport = async () => {
    setBusy(true);
    try { const r = await post<{ markdown: string; file: string }>('/api/models/report', { vendor: m.vendor, name: m.name }); setReport(r); toast.ok(`报告已写入 ${r.file}`); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="stack">
      <div className="detail-h">
        <div className="avatar" style={{ background: color }}>{(nm.blind ? '?' : m.name[0] || '?').toUpperCase()}</div>
        <div className="grow">
          <h2>{nm.blind ? nm.model(m.vendor, m.name) : m.display || m.name}</h2>
          <div className="muted small row gap-s wrap">
            {!nm.blind && <span className="mono">model/{m.vendor}/{m.name}/</span>}
            {m.harness && <Badge>{m.harness}</Badge>}
            {m.family && <Badge>{m.family}</Badge>}
            {m.release && <span>发布 {m.release}</span>}
            {(m.tags || []).map((t) => <Badge key={t} tone="accent">{t}</Badge>)}
          </div>
          {m.notes && !nm.blind && <p className="muted small">{m.notes}</p>}
        </div>
        <div className="row gap-s wrap">
          <Btn icon={<Pencil size={14} />} onClick={() => setEdit(true)}>编辑</Btn>
          <Btn icon={<FolderOpen size={14} />} onClick={() => void post('/api/open-folder', { path: `model/${m.vendor}/${m.name}` }).catch((e) => toast.error(e.message))}>打开文件夹</Btn>
          <Btn icon={<FileText size={14} />} busy={busy} onClick={genReport}>生成报告</Btn>
          <Btn tone="primary" icon={<Play size={14} />} onClick={() => setNewRun({})}>新建运行</Btn>
        </div>
      </div>

      <div className="grid-2">
        <Card title="榜单表现" sub={board.length > 1 ? `${board.length} 个 harness` : undefined}>
          {!board.length ? <p className="muted small">还没有已评分的运行。</p> : (
            <>
              <Radar axes={qd.map((d) => ({ id: d.id, label: d.name }))} series={board.map((b) => ({ key: b.entrant, label: b.harness, color: board.length > 1 ? nm.color(b.entrant + b.harness) : color, values: b.dims }))} size={320} />
              <table className="tbl">
                <thead><tr><th>Harness</th><th>名次</th><th className="num">质量</th><th className="num">达标率</th><th className="num">期望成本</th><th className="num">期望用时</th></tr></thead>
                <tbody>{board.map((b) => (
                  <tr key={b.entrant}><td>{b.harness}</td><td className="mono">{b.rank}</td><td className="num"><Score v={b.quality} /></td><td className="num">{fmt.pct(b.pass_rate)}</td><td className="num">{fmt.usd(b.suite_exp_cost_usd)}</td><td className="num">{fmt.min(b.suite_exp_min)}</td></tr>
                ))}</tbody>
              </table>
              <Btn size="sm" tone="ghost" onClick={() => go('board', ['compare'], { e: board.map((b) => b.entrant).join(',') })}>在对比页打开 →</Btn>
            </>
          )}
        </Card>
        <Card title="工作区统计">
          <div className="mini-stats">
            <div><b>{ws.length}</b><span>运行</span></div>
            <div><b>{ws.filter((w) => w.grader_run_id).length}</b><span>已登记</span></div>
            <div><b>{ws.filter((w) => runOf(w.grader_run_id)?.graded).length}</b><span>已评分</span></div>
            <div><b>{fmt.usd(ws.reduce((a, w) => a + (runOf(w.grader_run_id)?.usage.cost_usd || w.usage?.cost_usd || 0), 0) || null)}</b><span>累计费用</span></div>
            <div><b>{fmt.min(ws.reduce((a, w) => a + (runOf(w.grader_run_id)?.usage.wall_min || w.usage?.wall_min || 0), 0) || null)}</b><span>累计用时</span></div>
          </div>
          <p className="muted small">单模型报告存放在 <code>model/{nm.blind ? '…' : `${m.vendor}/${m.name}`}/_report/REPORT.md</code>，全局导出在 <code>reports/</code>。</p>
        </Card>
      </div>

      <Card title="题目 × 运行" sub={`每题需要 ${spec?.cfg.runs_per_task || 3} 次`} pad={false}>
        <table className="tbl">
          <thead><tr><th>题目</th><th>运行</th><th className="num">均分</th><th /></tr></thead>
          <tbody>{tkeys.map(({ t, v, k }) => {
            const rs = ws.filter((w) => w.tkey === k).sort((a, b) => a.index - b.index);
            const scores = rs.map((w) => runOf(w.grader_run_id)?.score?.total).filter((x): x is number => x != null);
            return (
              <tr key={k}>
                <td><span className="mono tid">{k}</span> {t.name}{v && <span className="muted small">（{v} 组）</span>}</td>
                <td>
                  <div className="run-pills">
                    {rs.map((w) => {
                      const r = runOf(w.grader_run_id);
                      return <a key={w.ref} className="run-pill" href={href('runs', [w.ref])} title={w.ref}><span className="mono">r{w.index}</span>{r?.score ? <Score v={r.score.total} d={0} /> : <WsBadge w={w} />}</a>;
                    })}
                    {rs.length < (spec?.cfg.runs_per_task || 3) && <button className="run-pill add" onClick={() => setNewRun({ task: t.id, variant: v || undefined })}><Plus size={12} />r{(rs.at(-1)?.index || 0) + 1}</button>}
                  </div>
                </td>
                <td className="num">{scores.length ? <Score v={scores.reduce((a, x) => a + x, 0) / scores.length} /> : <span className="muted">—</span>}</td>
                <td />
              </tr>
            );
          })}</tbody>
        </table>
      </Card>
      {edit && <ModelModal open onClose={() => setEdit(false)} init={m} />}
      {newRun && <NewRunModal open onClose={() => setNewRun(null)} preset={{ vendor: m.vendor, model: m.name, ...newRun }} />}
      <Modal open={!!report} onClose={() => setReport(null)} title={`报告 · ${report?.file || ''}`} width={900}>
        {report && <Markdown text={report.markdown} />}
      </Modal>
    </div>
  );
}
