// 速度与价格：权衡表、用时核实清单、单次运行的用时 / 费用卡片、模型额度读数。
import { useState } from 'react';
import { Clock3, Hourglass, ListChecks, Plus, RotateCcw, Trash2, Wallet } from 'lucide-react';
import type { BoardRow, BoardView, Dimension, EffMetric, ModelProfile, RunEff, StoreRun, TimeFlag, WorkspaceRun } from '../../shared/types';
import { QUOTA_UNITS } from '../../shared/quota';
import { post } from '../api';
import { useWb } from '../state';
import { go } from '../lib/router';
import { cls, fmt } from '../lib/format';
import { Badge, Btn, Card, CheckBox, Empty, Field, Kv, Select, confirmDialog } from '../ui/kit';
import { toast } from '../ui/toast';
import { Score, useNamer } from './common';
import { QuotaForm } from './LaunchPad';

/** 雷达轴：质量维度（按视图）+ 成本 / 速度 */
export const radarAxes = (dims: Dimension[] | undefined, view?: BoardView) =>
  (dims || []).filter((d) => !d.only_views || !view || d.only_views.includes(view)).filter((d) => d.kind === 'quality' || d.kind === 'efficiency').map((d) => ({ id: d.id, label: d.name }));

const SRC_T: Record<string, string> = { corrected: '手动修正', active: '有效时间', log: '日志墙钟', timestamp: '开始→结束时刻', none: '无' };
const SRC_C: Record<string, string> = { manual: '直接填写', quota: '额度差', ledger: '额度读数分摊', log: '日志', token: 'token × 单价', free: '免费', none: '未记录' };
const ST_T: Record<string, { label: string; tone: string }> = {
  ok: { label: '正常', tone: 'ok' }, pending: { label: '待核实', tone: 'warn' }, excluded: { label: '已排除', tone: 'muted' },
  included: { label: '核实后纳入', tone: 'info' }, corrected: { label: '已修正', tone: 'accent' }, none: { label: '无数据', tone: 'muted' },
};

/** 相对倍数：0.62×（快 38%） */
export function relText(rel: number | null | undefined, kind: 'time' | 'cost') {
  if (rel == null) return '—';
  const p = Math.round(Math.abs(1 - rel) * 100);
  const word = kind === 'time' ? (rel < 1 ? '快' : '慢') : (rel < 1 ? '便宜' : '贵');
  return `${rel.toFixed(2)}×${p >= 1 ? `（${word} ${p}%）` : '（持平）'}`;
}
const uncTone = (l: EffMetric['level']) => (l === '低' ? 'ok' : l === '中' ? 'warn' : l === '高' ? 'bad' : 'muted');
function Unc({ m }: { m: EffMetric }) {
  if (m.unc == null) return <span className="muted">—</span>;
  const why = [`题间与多次运行的离散`, m.excluded ? `${m.excluded} 次排除` : '', m.pending ? `${m.pending} 次待核实` : '', m.inferred ? `${m.inferred} 次为推算 / 估算` : '', m.tasks < m.tasks_total ? `覆盖 ${m.tasks}/${m.tasks_total} 题` : ''].filter(Boolean).join('、');
  return <Badge tone={uncTone(m.level)} title={`相对不确定性（1σ）：${why}`}>±{Math.round(m.unc * 100)}% · {m.level}</Badge>;
}
function Cover({ m }: { m: EffMetric }) {
  return <span className="small">{m.tasks}/{m.tasks_total} 题{m.excluded ? <span className="muted"> · 排除 {m.excluded}</span> : null}{m.pending ? <span className="tone-text-warn"> · 待核实 {m.pending}</span> : null}</span>;
}

/** 速度与价格权衡表 */
export function EffTable({ rows }: { rows: BoardRow[] }) {
  const wb = useWb();
  const nm = useNamer();
  const eff = wb.agg?.eff || {};
  const [sort, setSort] = useState<'quality' | 'time' | 'cost'>('quality');
  const list = [...rows].sort((a, b) => sort === 'quality' ? (b.quality ?? -1) - (a.quality ?? -1)
    : sort === 'time' ? (eff[a.entrant]?.time.rel ?? 1e9) - (eff[b.entrant]?.time.rel ?? 1e9) : (eff[a.entrant]?.cost.rel ?? 1e9) - (eff[b.entrant]?.cost.rel ?? 1e9));
  const pend = wb.agg?.pending.time_review || 0;
  return (
    <Card title="速度与价格权衡" pad={false} className="mt-l"
      sub="平均值看量级，相对值看快慢：每题与该题各参赛者的中位数比，按题几何加权并向基线收缩；± 是相对不确定性"
      extra={<>
        {pend > 0 && <Btn size="sm" tone="tinted" icon={<Hourglass size={13} />} onClick={() => document.getElementById('time-review')?.scrollIntoView({ behavior: 'smooth' })}>{pend} 次用时待核实</Btn>}
        <select className="input sm" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="排序"><option value="quality">按质量</option><option value="time">按速度</option><option value="cost">按价格</option></select>
      </>}>
      <div className="tbl-wrap"><table className="tbl">
        <thead>
          <tr><th rowSpan={2}>参赛者</th><th rowSpan={2} className="num">质量</th><th colSpan={5} className="center" style={{ color: 'var(--d-speed)' }}>速度</th><th colSpan={4} className="center" style={{ color: 'var(--d-cost)' }}>价格</th></tr>
          <tr>
            <th className="num">平均每题</th><th className="num">相对基线</th><th>不确定性</th><th>时间覆盖</th><th className="num" title="所有有基线的题按本参赛者的相对倍数折算">标准整套</th>
            <th className="num">平均每题</th><th className="num">相对基线</th><th>不确定性</th><th>费用覆盖</th>
          </tr>
        </thead>
        <tbody>{list.map((b) => {
          const e = eff[b.entrant];
          if (!e) return null;
          return (
            <tr key={b.entrant}>
              <td>{nm.entrant(b.entrant)}</td>
              <td className="num"><Score v={b.quality} /></td>
              <td className="num">{fmt.min(e.time.mean)}</td>
              <td className={cls('num', e.time.rel != null && (e.time.rel < 1 ? 'tone-text-ok' : 'tone-text-warn'))}>{relText(e.time.rel, 'time')}</td>
              <td><Unc m={e.time} /></td>
              <td><Cover m={e.time} /></td>
              <td className="num">{fmt.min(e.time.suite_est)}</td>
              <td className="num">{e.cost.mean == null ? <span className="muted">未记录</span> : fmt.usd(e.cost.mean)}</td>
              <td className={cls('num', e.cost.rel != null && (e.cost.rel < 1 ? 'tone-text-ok' : 'tone-text-warn'))}>{relText(e.cost.rel, 'cost')}</td>
              <td><Unc m={e.cost} /></td>
              <td><Cover m={e.cost} /></td>
            </tr>
          );
        })}</tbody>
      </table></div>
      <p className="muted xs" style={{ padding: '8px 14px 12px' }}>
        用时来源：手动修正 → 有效时间 → 日志墙钟 → 开始/结束时刻。单次超过 {fmtH(wb.spec?.cfg.efficiency?.time?.flag_minutes ?? 300)} 进入核实，核实前{(wb.spec?.cfg.efficiency?.time?.pending ?? 'exclude') === 'exclude' ? '暂不计入' : '暂按原值计入'}。
        费用来源：直接填写 → 额度差 → 额度读数分摊 → 日志 / token × 单价；没有记录的显示“未记录”，不补数、不算 0。雷达的成本 / 速度轴：持平基线 50 分，快（便宜）4 倍 100 分。
      </p>
    </Card>
  );
}
const fmtH = (m: number) => (m % 60 ? `${m} 分钟` : `${m / 60} 小时`);

/** 用时核实清单：超长 / 过短的运行，用户决定是否纳入时间统计 */
export function TimeReviewList() {
  const wb = useWb();
  const nm = useNamer();
  const flags = wb.agg?.time_flags || [];
  const [showDone, setShowDone] = useState(false);
  const pending = flags.filter((f) => f.status === 'pending');
  const list = showDone ? flags : pending;
  const act = async (f: TimeFlag, status: string, minutes?: number) => {
    try { await post('/api/eff/time-review', { run_id: f.run_id, status, minutes }); await wb.refresh(['store', 'agg']); } catch (e: any) { toast.error(e.message); }
  };
  const correct = async (f: TimeFlag) => {
    const s = window.prompt(`${f.tkey} 实际有效用时（分钟）？\n记录值 ${fmt.min(f.raw_min)}`, '');
    if (s == null || s.trim() === '') return;
    const m = Number(s);
    if (!Number.isFinite(m) || m <= 0) { toast.error('需要正数分钟'); return; }
    await act(f, 'corrected', m);
  };
  const excludeAll = async () => {
    if (!(await confirmDialog({ title: `把 ${pending.length} 次待核实的运行都标为“不纳入时间统计”？`, body: '只影响速度统计（并计入相对不确定性），质量分不变；之后仍可逐条改回纳入。', ok: '全部不纳入' }))) return;
    try { for (const f of pending) await post('/api/eff/time-review', { run_id: f.run_id, status: 'exclude', reason: '批量：超长用时' }); toast.ok('已标记'); await wb.refresh(['store', 'agg']); } catch (e: any) { toast.error(e.message); }
  };
  const withSuggest = pending.filter((f) => f.suggest_min != null);
  const suggestAll = async () => {
    if (!(await confirmDialog({ title: `按交付时间修正 ${withSuggest.length} 次运行的用时？`, body: '用“开跑 → 模型写出 FINAL_MESSAGE.md”的时长代替记录值（结束时间多半是很晚登记或归档时补的）。没有交付证据的仍待核实；之后可逐条撤销。', ok: '全部按交付时间修正' }))) return;
    try { for (const f of withSuggest) await post('/api/eff/time-review', { run_id: f.run_id, status: 'corrected', minutes: f.suggest_min, reason: '按 FINAL_MESSAGE.md 时间修正' }); toast.ok('已修正'); await wb.refresh(['store', 'agg']); } catch (e: any) { toast.error(e.message); }
  };
  return (
    <Card title={<span id="time-review" className="row gap-s"><Hourglass size={15} />用时核实</span>} pad={false} className="mt-l"
      sub={pending.length ? `${pending.length} 次运行的用时超出正常范围：可能断线、忘了结束或很晚才开跑。不纳入后只影响速度统计，并计入相对不确定性` : '没有待核实的运行'}
      extra={<>
        <label className="row gap-s small"><CheckBox checked={showDone} onChange={() => setShowDone(!showDone)} label="显示已核实" />显示已核实</label>
        {withSuggest.length > 0 && <Btn size="sm" tone="tinted" icon={<Clock3 size={13} />} onClick={() => void suggestAll()}>{withSuggest.length} 次按交付时间修正</Btn>}
        {pending.length > 1 && <Btn size="sm" icon={<ListChecks size={13} />} onClick={() => void excludeAll()}>全部不纳入</Btn>}
      </>}>
      {!list.length ? <Empty title={showDone ? '没有核实记录' : '用时都在正常范围内'} /> : (
        <div className="tbl-wrap" style={{ maxHeight: 460 }}><table className="tbl compact">
          <thead><tr><th>参赛者</th><th>题目</th><th className="num">记录用时</th><th className="num" title="开跑 → 模型写出 FINAL_MESSAGE.md">交付证据</th><th>来源</th><th>起止</th><th>原因</th><th>状态</th><th /></tr></thead>
          <tbody>{list.map((f) => (
            <tr key={f.run_id}>
              <td className="clickable" onClick={() => go('runs', [], { id: f.run_id })}>{nm.entrant(f.entrant)}</td>
              <td className="mono">{f.tkey}</td>
              <td className="num b">{fmt.min(f.raw_min)}{f.status === 'corrected' && f.minutes != null ? <span className="muted"> → {fmt.min(f.minutes)}</span> : null}</td>
              <td className="num">{f.suggest_min != null ? fmt.min(f.suggest_min) : <span className="muted">—</span>}</td>
              <td className="small">{SRC_T[f.source]}</td>
              <td className="small mono">{fmt.time(f.started_at)} → {fmt.time(f.ended_at)}</td>
              <td className="small">{f.flag}</td>
              <td><Badge tone={f.status === 'pending' ? 'warn' : f.status === 'exclude' ? 'muted' : 'info'}>{{ pending: '待核实', exclude: '不纳入', include: '纳入', corrected: '已修正' }[f.status]}</Badge></td>
              <td><span className="row gap-xs">
                {f.status === 'pending' && f.suggest_min != null && <Btn size="xs" tone="tinted" onClick={() => void act(f, 'corrected', f.suggest_min!)}>用 {fmt.min(f.suggest_min)}</Btn>}
                {f.status !== 'exclude' && <Btn size="xs" onClick={() => void act(f, 'exclude')}>不纳入</Btn>}
                {f.status !== 'include' && <Btn size="xs" tone="ghost" onClick={() => void act(f, 'include')}>纳入</Btn>}
                <Btn size="xs" tone="ghost" onClick={() => void correct(f)}>修正</Btn>
                {f.status !== 'pending' && <Btn size="xs" tone="ghost" icon={<RotateCcw size={11} />} tip="撤销核实决定" onClick={() => void act(f, 'clear')} />}
              </span></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </Card>
  );
}

/** 单次运行的用时与费用：来源、核实、直接估价、额度（任何时候都能改） */
export function RunEffCard({ run, ws }: { run: StoreRun; ws?: WorkspaceRun }) {
  const wb = useWb();
  const x: RunEff | undefined = wb.agg?.run_eff?.[run.run_id];
  const ov = wb.store?.eff?.cost?.[run.run_id];
  const [cost, setCost] = useState<string>(ov ? String(ov.cost_usd) : '');
  const [note, setNote] = useState(ov?.note || '');
  const prof: ModelProfile | undefined = wb.store?.models.find((m) => m.name === run.model && (!run.vendor || m.vendor === run.vendor));
  const refresh = () => wb.refresh(['store', 'agg']);
  const review = async (status: string, minutes?: number) => { try { await post('/api/eff/time-review', { run_id: run.run_id, status, minutes }); await refresh(); } catch (e: any) { toast.error(e.message); } };
  const saveCost = async (clear = false) => {
    try { await post('/api/eff/cost', { run_id: run.run_id, cost_usd: clear || cost.trim() === '' ? null : Number(cost), note }); if (clear) setCost(''); toast.ok(clear ? '已清除直接填写的费用' : '已保存费用'); await refresh(); } catch (e: any) { toast.error(e.message); }
  };
  if (!x) return <Card title="用时与费用"><Empty title="不在当前榜单视图里">切换到这次运行所属题库的视图后显示。</Empty></Card>;
  const st = ST_T[x.time_status];
  return (
    <Card title={<span className="row gap-s"><Clock3 size={15} />用时与费用</span>} sub="计入速度 / 价格统计的值与来源">
      <Kv rows={[
        ['计入用时', <span className="row gap-s">{fmt.min(x.minutes)}<Badge tone={st.tone}>{st.label}</Badge>{x.flag && <span className="muted small">{x.flag}</span>}</span>],
        ['记录用时', <>{fmt.min(x.raw_min)} <span className="muted small">· {SRC_T[x.time_source]}</span></>],
        ['计入费用', x.cost_usd == null ? <span className="muted">未记录{x.cost_note ? ` · ${x.cost_note}` : ''}</span> : <>{fmt.usd(x.cost_usd)} <span className="muted small">· {SRC_C[x.cost_source]}{x.cost_estimated ? '（估算）' : ''}{x.cost_note ? ` · ${x.cost_note}` : ''}</span></>],
      ]} />
      <div className="row gap-s mt wrap">
        <span className="small muted">时间统计：</span>
        {x.time_status !== 'excluded' && <Btn size="xs" onClick={() => void review('exclude')}>不纳入</Btn>}
        {x.suggest_min != null && <Btn size="xs" tone="tinted" tip="开跑 → 模型写出 FINAL_MESSAGE.md" onClick={() => void review('corrected', x.suggest_min!)}>按交付时间 {fmt.min(x.suggest_min)}</Btn>}
        {(x.time_status === 'pending' || x.time_status === 'excluded') && <Btn size="xs" tone="ghost" onClick={() => void review('include')}>纳入</Btn>}
        <Btn size="xs" tone="ghost" onClick={() => { const s = window.prompt('实际有效用时（分钟）', x.minutes ? x.minutes.toFixed(1) : ''); if (s && Number(s) > 0) void review('corrected', Number(s)); }}>修正分钟数</Btn>
        {wb.store?.eff?.time_review?.[run.run_id] && <Btn size="xs" tone="ghost" icon={<RotateCcw size={11} />} onClick={() => void review('clear')}>撤销</Btn>}
      </div>
      <div className="form-grid mt">
        <Field label="直接填写费用（美元）" hint="估算价也可以；优先于额度与日志"><input type="number" step="0.001" min="0" value={cost} onChange={(e) => setCost(e.target.value)} placeholder={x.cost_usd != null && x.cost_source !== 'manual' ? x.cost_usd.toFixed(3) : '未记录'} /></Field>
        <Field label="备注"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：按官网单价估算" /></Field>
      </div>
      <div className="row gap-s mt-s"><Btn size="sm" tone="tinted" onClick={() => void saveCost()}>保存费用</Btn>{ov && <Btn size="sm" tone="ghost" onClick={() => void saveCost(true)}>清除</Btn>}</div>
      {ws && prof && prof.billing?.mode !== 'token' && <div className="stack s mt"><QuotaForm run={ws} model={prof} phase="before" compact /><QuotaForm run={ws} model={prof} phase="after" compact /></div>}
    </Card>
  );
}

/** 模型的额度读数：随时补一条，两条读数之间用掉的额度按时间重叠分给那段时间里的运行 */
export function QuotaLedger({ model }: { model: ModelProfile }) {
  const wb = useWb();
  const key = `${model.vendor}/${model.name}`;
  const list = wb.store?.eff?.quota_log?.[key] || [];
  const [rem, setRem] = useState('');
  const [unit, setUnit] = useState(model.billing?.unit || '%');
  const [at, setAt] = useState('');
  const [note, setNote] = useState('');
  const [reset, setReset] = useState(false);
  const add = async () => {
    if (rem.trim() === '') return;
    try { await post('/api/eff/quota-log', { model: key, remaining: Number(rem), unit, at: at || undefined, note, reset }); setRem(''); setNote(''); setReset(false); setAt(''); toast.ok('已记录额度读数'); await wb.refresh(['store', 'agg']); } catch (e: any) { toast.error(e.message); }
  };
  const remove = async (id: string) => { try { await post('/api/eff/quota-log', { model: key, delete: id }); await wb.refresh(['store', 'agg']); } catch (e: any) { toast.error(e.message); } };
  return (
    <Card title={<span className="row gap-s"><Wallet size={15} />额度读数</span>} className="mt-l"
      sub="任何时候都可以记一次剩余额度。相邻两次读数之间用掉的额度按时间重叠分给那段时间里的运行（并发也能拆）；剩余变多视为周期重置，那一段不计。期间做的非测评使用也会算进去。">
      <div className="row gap-s wrap">
        <input className="input" type="number" step="any" value={rem} onChange={(e) => setRem(e.target.value)} placeholder="现在还剩多少" style={{ maxWidth: 160 }} onKeyDown={(e) => { if (e.key === 'Enter') void add(); }} />
        <Select size="sm" value={unit} onChange={setUnit} options={QUOTA_UNITS.map((u) => ({ value: u, label: u }))} />
        <input className="input" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} title="留空 = 现在" style={{ maxWidth: 210 }} />
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="备注（可选）" style={{ maxWidth: 200 }} />
        <label className="row gap-s small"><CheckBox checked={reset} onChange={() => setReset(!reset)} label="周期刚重置" />周期刚重置</label>
        <Btn size="sm" tone="tinted" icon={<Plus size={13} />} onClick={() => void add()}>记录</Btn>
      </div>
      {!model.billing?.monthly_fee && unit !== '美元' && <p className="tone-text-warn small mt-s">这个模型还没填订阅周期费用与额度（在开跑前的额度卡片里设置），额度暂时无法换算成美元。</p>}
      {list.length > 0 && (
        <div className="tbl-wrap mt"><table className="tbl compact">
          <thead><tr><th>时间</th><th className="num">剩余</th><th>备注</th><th /></tr></thead>
          <tbody>{[...list].reverse().map((q) => (
            <tr key={q.id}><td className="mono small">{fmt.time(q.at)}</td><td className="num">{q.remaining} {q.unit || ''}</td><td className="small">{q.reset ? <Badge tone="info">周期重置</Badge> : null} {q.note}</td>
              <td><Btn size="xs" tone="ghost" icon={<Trash2 size={11} />} tip="删除这条读数" onClick={() => void remove(q.id)} /></td></tr>
          ))}</tbody>
        </table></div>
      )}
    </Card>
  );
}
