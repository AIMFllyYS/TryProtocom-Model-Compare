// 排行与对比：排行榜（置信区间 + 维度）、多参赛者对比、题目热力矩阵、效率帕累托、A/C 增益、题目分析、失败归因。
import { useMemo, useState } from 'react';
import { ArrowDownUp, GitCompareArrows, MonitorPlay, Trophy } from 'lucide-react';
import type { BoardRow, TaskRow } from '../../shared/types';
import { useWb } from '../state';
import { go, useLocal, useRoute } from '../lib/router';
import { cls, fmt, splitEntrant } from '../lib/format';
import { Badge, Btn, Card, Drawer, Empty, Kv, Seg, Tabs } from '../ui/kit';
import { CiBar, heat, Pareto, Radar } from '../ui/charts';
import { DimChip, Score, TaskLabel, useNamer } from '../components/common';

type Tab = 'board' | 'compare' | 'matrix' | 'eff' | 'uplift' | 'items' | 'failures';

export default function Board() {
  const wb = useWb();
  const route = useRoute();
  const tab = (route.parts[0] as Tab) || 'board';
  const agg = wb.agg;
  const setTab = (t: Tab) => go('board', t === 'board' ? [] : [t], t === 'compare' ? { e: route.query.get('e') } : undefined);
  const [sel, setSel] = useLocal<string[]>('board.sel', []);
  const selected = route.query.get('e') ? route.query.get('e')!.split(',').filter(Boolean) : sel;
  if (!agg) return <div className="page"><Empty title="加载中…" /></div>;
  if (!agg.board.length) {
    return (
      <div className="page">
        <Empty icon={<Trophy size={30} />} title="还没有可汇总的评分结果" action={<Btn tone="primary" onClick={() => go('runs')}>去运行页登记并评分</Btn>}>
          排行榜来自存储文件 <code>data/bench-store.json</code> 中的已评分运行。复制该文件到另一台电脑、在“系统”页导入，同样可以出榜。
        </Empty>
      </div>
    );
  }
  return (
    <div className="page">
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'board', label: '排行榜', count: agg.board.length },
        { value: 'compare', label: '对比', count: selected.length || undefined },
        { value: 'matrix', label: '题目矩阵' },
        { value: 'eff', label: '效率与帕累托' },
        { value: 'uplift', label: 'Skill 增益（A/C）', count: agg.uplift.length || undefined },
        { value: 'items', label: '题目分析', count: agg.items.filter((i) => i.flag).length || undefined, tone: 'warn' },
        { value: 'failures', label: '失败归因', count: agg.failures.length || undefined, tone: 'bad' },
      ]} extra={<span className="muted small">生成于 {fmt.time(agg.generated_at)}</span>} />
      {tab === 'board' && <Leaderboard selected={sel} setSelected={setSel} />}
      {tab === 'compare' && <Compare selected={selected} setSelected={(s) => { setSel(s); go('board', ['compare'], { e: s.join(',') }, true); }} />}
      {tab === 'matrix' && <Matrix />}
      {tab === 'eff' && <Efficiency />}
      {tab === 'uplift' && <Uplift />}
      {tab === 'items' && <Items />}
      {tab === 'failures' && <Failures />}
    </div>
  );
}

function useQDims() {
  const { spec } = useWb();
  return (spec?.dims || []).filter((d) => d.kind === 'quality');
}

function Leaderboard({ selected, setSelected }: { selected: string[]; setSelected: (s: string[]) => void }) {
  const { agg, spec } = useWb();
  const nm = useNamer();
  const qd = useQDims();
  const [sort, setSort] = useState<{ k: string; dir: 1 | -1 }>({ k: 'quality', dir: -1 });
  const composite = spec?.config_full.composite?.enabled;
  const rows = useMemo(() => {
    const val = (b: BoardRow): number => {
      if (sort.k === 'quality') return b.quality ?? -1;
      if (sort.k === 'composite') return b.composite ?? -1;
      if (sort.k === 'pass') return b.pass_rate;
      if (sort.k === 'cost') return -(b.suite_exp_cost_usd ?? 1e9);
      if (sort.k === 'time') return -(b.suite_exp_min ?? 1e9);
      return b.dims[sort.k] ?? -1;
    };
    return [...agg!.board].sort((a, b) => (sort.dir === -1 ? val(b) - val(a) : val(a) - val(b)));
  }, [agg, sort]);
  const th = (k: string, label: string, title?: string) => (
    <th className={cls('num sortable', sort.k === k && 'sorted')} title={title} onClick={() => setSort({ k, dir: sort.k === k ? (sort.dir === 1 ? -1 : 1) : -1 })}>
      {label}{sort.k === k && <ArrowDownUp size={11} />}
    </th>
  );
  const toggle = (e: string) => setSelected(selected.includes(e) ? selected.filter((x) => x !== e) : [...selected, e]);
  return (
    <>
      <div className="toolbar">
        <span className="muted small">勾选参赛者后可对比；名次后带“=”表示与上一名置信区间重叠（统计上并列）。</span>
        <div className="grow" />
        <Btn icon={<GitCompareArrows size={15} />} disabled={selected.length < 1} onClick={() => go('board', ['compare'], { e: selected.join(',') })}>对比所选（{selected.length}）</Btn>
      </div>
      <Card pad={false}>
        <div className="tw">
          <table className="tbl board">
            <thead>
              <tr>
                <th style={{ width: 28 }} />
                <th>名次</th>
                <th>参赛者（模型 @ harness）</th>
                {th('quality', '质量总分', '7 个质量维度加权；条带为 95% bootstrap 置信区间')}
                {composite && th('composite', '综合分', '质量 + 成本 + 速度加权')}
                {qd.map((d) => <th key={d.id} className={cls('num sortable', sort.k === d.id && 'sorted')} onClick={() => setSort({ k: d.id, dir: -1 })} title={d.desc}><span className="dim-h" style={{ borderColor: `var(--d-${d.id})` }}>{d.name}</span></th>)}
                {th('pass', '达标率')}
                {th('cost', '整套期望成本', '单次平均费用 ÷ 达标率，对全部题目求和')}
                {th('time', '整套期望用时')}
                <th className="num">运行</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.entrant} className={selected.includes(b.entrant) ? 'sel' : undefined}>
                  <td><input type="checkbox" checked={selected.includes(b.entrant)} onChange={() => toggle(b.entrant)} aria-label={`选择 ${b.entrant}`} /></td>
                  <td className="mono rank">{b.rank}</td>
                  <td>
                    <div className="ent">
                      <i className="dot" style={{ background: nm.color(b.entrant) }} />
                      <div>
                        <div className="ent-n">{nm.blind ? nm.entrant(b.entrant) : splitEntrant(b.entrant).model}</div>
                        {!nm.blind && <div className="muted small">{b.vendor ? b.vendor + ' · ' : ''}{b.harness}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="num">
                    <div className="q-cell"><Score v={b.quality} big /><CiBar v={b.quality} lo={b.ci_low} hi={b.ci_high} color={nm.color(b.entrant)} /></div>
                    <div className="muted xs mono">{b.ci_low != null ? `${fmt.n(b.ci_low)}–${fmt.n(b.ci_high)}` : ''}</div>
                  </td>
                  {composite && <td className="num"><Score v={b.composite} /></td>}
                  {qd.map((d) => <td key={d.id} className="num heat" style={{ background: heat(b.dims[d.id]) }}>{fmt.n(b.dims[d.id])}</td>)}
                  <td className="num">{fmt.pct(b.pass_rate)}</td>
                  <td className="num">{fmt.usd(b.suite_exp_cost_usd)}<div className="muted xs">{b.cost_coverage}</div></td>
                  <td className="num">{fmt.min(b.suite_exp_min)}</td>
                  <td className="num mono">{b.runs}<span className="muted">/{b.tasks}题</span></td>
                  <td>{!b.complete ? <Badge tone="warn">评分不完整</Badge> : b.na_ratio > (spec?.cfg.low_confidence_na_ratio || 0.2) ? <Badge tone="muted">低可信</Badge> : <Badge tone="ok">完整</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function Compare({ selected, setSelected }: { selected: string[]; setSelected: (s: string[]) => void }) {
  const { agg, store } = useWb();
  const nm = useNamer();
  const qd = useQDims();
  const ents = agg!.board.filter((b) => selected.includes(b.entrant));
  const base = ents[0];
  if (!ents.length) {
    return <Empty icon={<GitCompareArrows size={28} />} title="选择要对比的参赛者" action={<div className="chips">{agg!.board.map((b) => <button key={b.entrant} className="chip btnchip" onClick={() => setSelected([...selected, b.entrant])}><i className="dot" style={{ background: nm.color(b.entrant) }} />{nm.entrant(b.entrant)}</button>)}</div>}>在排行榜勾选，或直接点下方参赛者加入对比。</Empty>;
  }
  const tkeys = agg!.tkeys;
  const tr = (e: string, k: string) => agg!.tasks.find((t) => t.entrant === e && t.task === k);
  const openStage = (k: string) => {
    const refs: string[] = [];
    for (const e of ents) {
      const { model, harness } = splitEntrant(e.entrant);
      const r = (store?.runs || []).filter((x) => x.model === model && x.harness === harness && x.tkey === k).sort((a, b) => (b.score?.total ?? 0) - (a.score?.total ?? 0))[0];
      if (r) refs.push(r.ws_ref ? 'ws:' + r.ws_ref : 'run:' + r.run_id);
    }
    if (refs.length) go('stage', [], { open: refs.join(',') });
  };
  return (
    <div className="stack">
      <div className="toolbar">
        <div className="chips">
          {ents.map((b) => <span key={b.entrant} className="chip"><i className="dot" style={{ background: nm.color(b.entrant) }} />{nm.entrant(b.entrant)}<button className="chip-x" aria-label="移除" onClick={() => setSelected(selected.filter((x) => x !== b.entrant))}>×</button></span>)}
          {agg!.board.filter((b) => !selected.includes(b.entrant)).map((b) => <button key={b.entrant} className="chip btnchip dim" onClick={() => setSelected([...selected, b.entrant])}>+ {nm.entrant(b.entrant)}</button>)}
        </div>
      </div>
      <div className="grid-2">
        <Card title="维度雷达">
          <Radar axes={qd.map((d) => ({ id: d.id, label: d.name }))} series={ents.map((b) => ({ key: b.entrant, label: nm.entrant(b.entrant), color: nm.color(b.entrant), values: b.dims }))} size={420} />
        </Card>
        <Card title="逐维度" sub={ents.length > 1 ? `差值相对 ${nm.entrant(base.entrant)}` : undefined} pad={false}>
          <table className="tbl">
            <thead><tr><th>维度</th>{ents.map((b) => <th key={b.entrant} className="num"><i className="dot" style={{ background: nm.color(b.entrant) }} /></th>)}</tr></thead>
            <tbody>
              <tr className="strong"><td>质量总分</td>{ents.map((b) => <td key={b.entrant} className="num"><Score v={b.quality} />{b !== base && <Delta a={b.quality} b={base.quality} />}</td>)}</tr>
              {qd.map((d) => <tr key={d.id}><td><DimChip id={d.id} /></td>{ents.map((b) => <td key={b.entrant} className="num heat" style={{ background: heat(b.dims[d.id]) }}>{fmt.n(b.dims[d.id])}{b !== base && <Delta a={b.dims[d.id]} b={base.dims[d.id]} />}</td>)}</tr>)}
              <tr><td>达标率</td>{ents.map((b) => <td key={b.entrant} className="num">{fmt.pct(b.pass_rate)}</td>)}</tr>
              <tr><td>整套期望成本</td>{ents.map((b) => <td key={b.entrant} className="num">{fmt.usd(b.suite_exp_cost_usd)}</td>)}</tr>
              <tr><td>整套期望用时</td>{ents.map((b) => <td key={b.entrant} className="num">{fmt.min(b.suite_exp_min)}</td>)}</tr>
            </tbody>
          </table>
        </Card>
      </div>
      <Card title="逐题对比" sub="均值 ± 标准差；点击“并排预览”在舞台同时打开各参赛者该题的最高分产物" pad={false}>
        <div className="tw">
          <table className="tbl">
            <thead><tr><th>题目</th>{ents.map((b) => <th key={b.entrant}><span className="row gap-xs"><i className="dot" style={{ background: nm.color(b.entrant) }} />{nm.entrant(b.entrant)}</span></th>)}<th /></tr></thead>
            <tbody>
              {tkeys.map((k) => (
                <tr key={k}>
                  <td><TaskLabel task={k.slice(0, 3)} variant={k.slice(3) || null} /></td>
                  {ents.map((b) => {
                    const t = tr(b.entrant, k);
                    return <td key={b.entrant}>{t ? <div className="bar-cell"><span className="bar" style={{ width: `${t.mean}%`, background: nm.color(b.entrant) }} /><span className="mono small">{fmt.n(t.mean)}<span className="muted"> ±{fmt.n(t.sd)}</span></span>{t.gate_fail_runs > 0 && <Badge tone="bad">门槛×{t.gate_fail_runs}</Badge>}</div> : <span className="muted">—</span>}</td>;
                  })}
                  <td><Btn size="xs" tone="ghost" icon={<MonitorPlay size={13} />} onClick={() => openStage(k)}>并排预览</Btn></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="分层得分" sub="基础项都满分时，差距体现在进阶与卓越层">
        <div className="tiers">
          {(['basic', 'advanced', 'excellent', 'clean'] as const).map((tier) => (
            <div key={tier} className="tier-col">
              <div className={`tier-h tier-${tier}`}>{{ basic: '基础', advanced: '进阶', excellent: '卓越', clean: '扣分项' }[tier]}</div>
              {ents.map((b) => {
                const ts = agg!.tasks.filter((t) => t.entrant === b.entrant).map((t) => t.tiers[tier]).filter((x): x is number => x != null);
                const v = ts.length ? ts.reduce((a, x) => a + x, 0) / ts.length : null;
                return <div key={b.entrant} className="bar-cell"><span className="bar" style={{ width: `${v ?? 0}%`, background: nm.color(b.entrant) }} /><span className="mono small">{fmt.n(v)}</span></div>;
              })}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
function Delta({ a, b }: { a: number | null | undefined; b: number | null | undefined }) {
  if (a == null || b == null) return null;
  const d = a - b;
  if (Math.abs(d) < 0.05) return null;
  return <span className={cls('delta', d > 0 ? 'up' : 'down')}>{d > 0 ? '+' : ''}{d.toFixed(1)}</span>;
}

function Matrix() {
  const { agg, store } = useWb();
  const nm = useNamer();
  const [mode, setMode] = useLocal<'mean' | 'pass' | 'cost' | 'time'>('matrix.mode', 'mean');
  const [cell, setCell] = useState<TaskRow | null>(null);
  const ents = agg!.board.map((b) => b.entrant);
  const val = (t: TaskRow) => mode === 'mean' ? fmt.n(t.mean) : mode === 'pass' ? fmt.pct(t.pass_rate) : mode === 'cost' ? fmt.usd(t.mean_cost_usd) : fmt.min(t.mean_min);
  const col = (t: TaskRow) => mode === 'mean' ? heat(t.mean) : mode === 'pass' ? heat(t.pass_rate * 100) : undefined;
  const runsOf = (t: TaskRow) => {
    const { model, harness } = splitEntrant(t.entrant);
    return (store?.runs || []).filter((r) => r.model === model && r.harness === harness && r.tkey === t.task);
  };
  return (
    <div className="stack">
      <div className="toolbar"><Seg value={mode} onChange={setMode} options={[{ value: 'mean', label: '均值' }, { value: 'pass', label: '达标率' }, { value: 'cost', label: '单次费用' }, { value: 'time', label: '单次用时' }]} /><span className="muted small">点击格子查看该参赛者该题的维度、分层与每次运行</span></div>
      <Card pad={false}>
        <div className="tw">
          <table className="tbl matrix">
            <thead><tr><th>参赛者</th>{agg!.tkeys.map((k) => <th key={k} className="c mono">{k}</th>)}</tr></thead>
            <tbody>
              {ents.map((e) => (
                <tr key={e}>
                  <td><span className="row gap-xs"><i className="dot" style={{ background: nm.color(e) }} />{nm.entrant(e)}</span></td>
                  {agg!.tkeys.map((k) => {
                    const t = agg!.tasks.find((x) => x.entrant === e && x.task === k);
                    return <td key={k} className="c">{t ? <button className="heat-cell" style={{ background: col(t) }} onClick={() => setCell(t)} title={`${t.runs} 次 · 最低 ${fmt.n(t.min)} · 最高 ${fmt.n(t.max)}`}>{val(t)}{mode === 'mean' && <span className="xs muted">±{fmt.n(t.sd, 0)}</span>}{!t.complete && <i className="warn-dot" />}</button> : <span className="muted">·</span>}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Drawer open={!!cell} onClose={() => setCell(null)} title={cell && <>{nm.entrant(cell.entrant)} · <TaskLabel task={cell.task.slice(0, 3)} variant={cell.task.slice(3) || null} /></>} width={760}>
        {cell && (
          <div className="stack">
            <Kv rows={[
              ['均值 ± 标准差', `${fmt.n(cell.mean)} ± ${fmt.n(cell.sd)}（${cell.runs} 次，最低 ${fmt.n(cell.min)}，最高 ${fmt.n(cell.max)}）`],
              ['达标率 / pass@k', `${fmt.pct(cell.pass_rate)} · ${cell.pass_at_k ? '是' : '否'}`],
              ['门槛失败', cell.gate_fail_runs],
              ['单次费用 / 用时', `${fmt.usd(cell.mean_cost_usd)} · ${fmt.min(cell.mean_min)}`],
              ['期望成功成本 / 用时', `${fmt.usd(cell.exp_cost_usd)} · ${fmt.min(cell.exp_min)}`],
            ]} />
            <h4>维度</h4>
            <div className="chips">{Object.entries(cell.dims).filter(([, v]) => v != null).map(([d, v]) => <span key={d} className="chip"><i className="dot" style={{ background: `var(--d-${d})` }} /><DimName id={d} /> <b className="mono">{fmt.n(v)}</b></span>)}</div>
            <h4>分层</h4>
            <div className="chips">{Object.entries(cell.tiers).filter(([, v]) => v != null).map(([t, v]) => <span key={t} className={`chip tier-${t}`}>{{ basic: '基础', advanced: '进阶', excellent: '卓越', clean: '扣分项' }[t] || t} <b className="mono">{fmt.n(v)}</b></span>)}</div>
            <h4>运行</h4>
            <table className="tbl">
              <thead><tr><th>运行</th><th className="num">总分</th><th>门槛</th><th /></tr></thead>
              <tbody>{runsOf(cell).map((r) => (
                <tr key={r.run_id}>
                  <td className="mono small">{nm.run(r)}</td>
                  <td className="num"><Score v={r.score?.total} /></td>
                  <td>{r.score ? (r.score.gate_pass ? <Badge tone="ok">通过</Badge> : <Badge tone="bad">未过</Badge>) : <Badge>未评分</Badge>}</td>
                  <td className="row gap-xs"><Btn size="xs" tone="ghost" onClick={() => go('runs', r.ws_ref ? [r.ws_ref] : [], { id: r.run_id })}>详情</Btn><Btn size="xs" tone="ghost" icon={<MonitorPlay size={12} />} onClick={() => go('stage', [], { open: r.ws_ref ? 'ws:' + r.ws_ref : 'run:' + r.run_id })}>预览</Btn></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Drawer>
    </div>
  );
}
function DimName({ id }: { id: string }) { const { spec } = useWb(); return <>{spec?.dims.find((d) => d.id === id)?.name || id}</>; }

function Efficiency() {
  const { agg, spec } = useWb();
  const nm = useNamer();
  const pts = agg!.board.filter((b) => b.quality != null && b.suite_exp_cost_usd != null && b.suite_exp_cost_usd > 0);
  const front = new Set<string>();
  // 帕累托：没有任何一个点同时更便宜且质量更高
  for (const p of pts) if (!pts.some((q) => q !== p && q.suite_exp_cost_usd! <= p.suite_exp_cost_usd! && q.quality! >= p.quality! && (q.suite_exp_cost_usd! < p.suite_exp_cost_usd! || q.quality! > p.quality!))) front.add(p.entrant);
  const ef = spec?.cfg.efficiency;
  const rows = agg!.board.map((b) => {
    const ts = agg!.tasks.filter((t) => t.entrant === b.entrant);
    const avg = (f: (t: TaskRow) => number | null) => { const v = ts.map(f).filter((x): x is number => x != null); return v.length ? v.reduce((a, x) => a + x, 0) / v.length : null; };
    return { b, cost: avg((t) => t.cost_score), speed: avg((t) => t.speed_score) };
  });
  return (
    <div className="stack">
      <div className="grid-2">
        <Card title="质量 × 成本 帕累托" sub="实线连接帕累托前沿（没有别人既更便宜又更好）">
          <Pareto points={pts.map((b) => ({ key: b.entrant, label: nm.entrant(b.entrant), x: b.suite_exp_cost_usd!, y: b.quality!, color: nm.color(b.entrant), frontier: front.has(b.entrant) }))} />
        </Card>
        <Card title="质量 × 用时">
          <Pareto log={false} xLabel="整套期望用时（分钟）" points={agg!.board.filter((b) => b.quality != null && b.suite_exp_min != null).map((b) => ({ key: b.entrant, label: nm.entrant(b.entrant), x: b.suite_exp_min!, y: b.quality!, color: nm.color(b.entrant) }))} />
        </Card>
      </div>
      <Card title="效率明细" sub={ef ? `锚点固定：费用 ≤ $${ef.cost.best} 记 100、≥ $${ef.cost.worst} 记 0；用时 ≤ ${ef.speed.best} 分记 100、≥ ${ef.speed.worst} 分记 0（对数刻度）` : undefined} pad={false}>
        <table className="tbl">
          <thead><tr><th>参赛者</th><th className="num">质量</th><th className="num">达标率</th><th className="num">整套期望成本</th><th className="num">整套期望用时</th><th className="num">成本效率分</th><th className="num">速度分</th><th>成本覆盖</th><th /></tr></thead>
          <tbody>{rows.map(({ b, cost, speed }) => (
            <tr key={b.entrant}>
              <td><span className="row gap-xs"><i className="dot" style={{ background: nm.color(b.entrant) }} />{nm.entrant(b.entrant)}</span></td>
              <td className="num"><Score v={b.quality} /></td>
              <td className="num">{fmt.pct(b.pass_rate)}</td>
              <td className="num">{fmt.usd(b.suite_exp_cost_usd)}</td>
              <td className="num">{fmt.min(b.suite_exp_min)}</td>
              <td className="num heat" style={{ background: heat(cost) }}>{fmt.n(cost)}</td>
              <td className="num heat" style={{ background: heat(speed) }}>{fmt.n(speed)}</td>
              <td className="small muted">{b.cost_coverage}</td>
              <td>{front.has(b.entrant) && <Badge tone="ok">前沿</Badge>}</td>
            </tr>
          ))}</tbody>
        </table>
      </Card>
    </div>
  );
}

function Uplift() {
  const { agg } = useWb();
  const nm = useNamer();
  if (!agg!.uplift.length) return <Empty title="暂无 A/C 对照数据">同一参赛者需要同时完成 T03 的 A 组（无 skill）与 C 组（预装 HyperFrames skills）。</Empty>;
  return (
    <Card title="T03 Skill 增益" sub="C 组 − A 组；正值表示 skill 带来提升" pad={false}>
      <table className="tbl">
        <thead><tr><th>参赛者</th><th className="num">A 组</th><th className="num">C 组</th><th className="num">总分增益</th><th className="num">动画 A → C</th><th className="num">动画增益</th><th className="num">费用 A → C</th><th className="num">用时 A → C</th></tr></thead>
        <tbody>{agg!.uplift.map((u) => (
          <tr key={u.entrant}>
            <td>{nm.entrant(u.entrant)}</td>
            <td className="num">{fmt.n(u.A_mean)}</td><td className="num">{fmt.n(u.C_mean)}</td>
            <td className="num"><span className={cls('delta', u.uplift >= 0 ? 'up' : 'down')}>{u.uplift >= 0 ? '+' : ''}{fmt.n(u.uplift)}</span></td>
            <td className="num">{fmt.n(u.A_anim)} → {fmt.n(u.C_anim)}</td>
            <td className="num"><span className={cls('delta', u.anim_uplift >= 0 ? 'up' : 'down')}>{u.anim_uplift >= 0 ? '+' : ''}{fmt.n(u.anim_uplift)}</span></td>
            <td className="num">{fmt.usd(u.A_cost)} → {fmt.usd(u.C_cost)}</td>
            <td className="num">{fmt.min(u.A_min)} → {fmt.min(u.C_min)}</td>
          </tr>
        ))}</tbody>
      </table>
    </Card>
  );
}

function Items() {
  const { agg } = useWb();
  const [flag, setFlag] = useState('');
  const [q, setQ] = useState('');
  const flags = [...new Set(agg!.items.map((i) => i.flag).filter(Boolean))];
  const rows = agg!.items.filter((i) => (!flag || i.flag === flag) && (!q || (i.item_id + i.desc + i.task).toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="stack">
      <div className="toolbar">
        <Seg value={flag} onChange={setFlag} options={[{ value: '', label: '全部' }, ...flags.map((f) => ({ value: f, label: f }))]} />
        <input className="search" placeholder="搜索检查项" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted small">参赛者间标准差小 → 区分度低；平均分接近 1 / 0 → 天花板 / 地板。用来迭代题库。</span>
      </div>
      <Card pad={false}>
        <div className="tw">
          <table className="tbl">
            <thead><tr><th>题目</th><th>检查项</th><th>维度</th><th>层级</th><th>方式</th><th className="num">平均分</th><th className="num">参赛者间 SD</th><th className="num">参赛者内 SD</th><th className="num">N</th><th>标记</th></tr></thead>
            <tbody>{rows.map((i) => (
              <tr key={i.task + i.item_id}>
                <td className="mono">{i.task}</td>
                <td><span className="mono small">{i.item_id}</span> <span className="small">{i.desc}</span></td>
                <td><DimChip id={i.dim} /></td>
                <td className={`tier-${i.tier} small`}>{{ basic: '基础', advanced: '进阶', excellent: '卓越', clean: '扣分项' }[i.tier] || i.tier}</td>
                <td className={`m-${i.method} small`}>{{ auto: '自动', agent: 'Agent', human: '人工' }[i.method] || i.method}</td>
                <td className="num heat" style={{ background: heat(i.mean * 100) }}>{fmt.n(i.mean, 2)}</td>
                <td className="num">{fmt.n(i.between_sd, 2)}</td>
                <td className="num">{fmt.n(i.within_sd, 2)}</td>
                <td className="num">{i.n}</td>
                <td>{i.flag && <Badge tone="warn">{i.flag}</Badge>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Failures() {
  const { agg, store } = useWb();
  const nm = useNamer();
  if (!agg!.failures.length) return <Empty title="没有门槛失败或未达标的运行" />;
  return (
    <Card pad={false}>
      <table className="tbl">
        <thead><tr><th>参赛者</th><th>题目</th><th>运行</th><th className="num">总分</th><th>归因</th><th /></tr></thead>
        <tbody>{agg!.failures.map((f) => {
          const r = store?.runs.find((x) => x.run_id === f.run_id);
          return (
            <tr key={f.run_id}>
              <td>{nm.entrant(f.entrant)}</td>
              <td className="mono">{f.task}</td>
              <td className="mono small">{r ? nm.run(r) : f.run_id}</td>
              <td className="num"><Score v={f.total} /></td>
              <td className="small">{f.tags || <span className="muted">未标注</span>}</td>
              <td><Btn size="xs" tone="ghost" onClick={() => go('runs', r?.ws_ref ? [r.ws_ref] : [], { id: f.run_id })}>详情</Btn></td>
            </tr>
          );
        })}</tbody>
      </table>
    </Card>
  );
}
