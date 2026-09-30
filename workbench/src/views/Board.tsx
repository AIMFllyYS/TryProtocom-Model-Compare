// 排行榜：领奖台 + 可排序总榜（勾选即对比）+ 维度 / 逐题热力 + 效率帕累托 + 检查项分析 + Skill 增益 + 失败归因。
import { useMemo, useRef, useState } from 'react';
import { ArrowDownUp, Crown, Download, GitCompareArrows, PackageOpen, Trophy } from 'lucide-react';
import type { BoardRow } from '../../shared/types';
import { useWb } from '../state';
import { go, useLocal } from '../lib/router';
import { cls, fmt, splitEntrant } from '../lib/format';
import { exportAllCharts } from '../lib/exporter';
import { Badge, Btn, Card, CheckBox, Empty, Seg } from '../ui/kit';
import { ChartCard, CiBar, heat, Heatmap, Legend, Pareto, Radar } from '../ui/charts';
import { HarnessIcon, ModelAvatar } from '../ui/brand';
import { toast } from '../ui/toast';
import { Score, useNamer } from '../components/common';

type Tab = 'board' | 'dims' | 'tasks' | 'eff' | 'items' | 'uplift' | 'fail';
type SortK = 'rank' | 'quality' | 'pass' | 'cost' | 'time' | string;

export default function Board() {
  const wb = useWb();
  const nm = useNamer();
  const [tab, setTab] = useLocal<Tab>('board.tab', 'board');
  const [sel, setSel] = useLocal<string[]>('board.sel', []);
  const [sort, setSort] = useState<{ k: SortK; asc: boolean }>({ k: 'rank', asc: true });
  const [hover, setHover] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const agg = wb.agg;
  const dims = (wb.spec?.dims || []).filter((d) => d.kind === 'quality');
  const board = useMemo(() => {
    const b = [...(agg?.board || [])];
    const val = (r: BoardRow): number => sort.k === 'rank' ? parseFloat(r.rank) || 999 : sort.k === 'quality' ? r.quality ?? -1 : sort.k === 'pass' ? r.pass_rate : sort.k === 'cost' ? r.suite_exp_cost_usd ?? 1e9 : sort.k === 'time' ? r.suite_exp_min ?? 1e9 : r.dims[sort.k] ?? -1;
    b.sort((x, y) => (val(x) - val(y)) * (sort.asc ? 1 : -1));
    return b;
  }, [agg, sort]);
  if (!agg) return <div className="page"><div className="skel" style={{ height: 400 }} /></div>;
  if (!agg.board.length) return (
    <div className="page"><Head n={0} />
      <Card><Empty icon={<Trophy size={30} />} title="还没有评分结果" action={<Btn tone="primary" onClick={() => go('tasks')}>去题目页开始测评</Btn>}>完成至少一次运行的登记与自动评分后，这里会出现总榜、雷达与效率对比。</Empty></Card>
    </div>
  );
  const toggle = (e: string) => setSel(sel.includes(e) ? sel.filter((x) => x !== e) : [...sel, e].slice(-6));
  const th = (k: SortK, label: string, cls2 = '') => <th className={cls('sortable', cls2)} onClick={() => setSort({ k, asc: sort.k === k ? !sort.asc : k === 'rank' || k === 'cost' || k === 'time' })}>{label}{sort.k === k && <ArrowDownUp size={11} style={{ display: 'inline', marginLeft: 3, opacity: .6 }} />}</th>;
  const top = agg.board.slice(0, 3);
  const vendorOf = (e: string) => nm.vendorOf(e);
  const color = (e: string) => nm.color(e);
  const radarSeries = (sel.length ? agg.board.filter((b) => sel.includes(b.entrant)) : agg.board.slice(0, 5)).map((b) => ({ key: b.entrant, label: nm.entrant(b.entrant), color: color(b.entrant), values: b.dims }));
  const exportAll = async () => { const n = await exportAllCharts(box.current!, `leaderboard-charts-${new Date().toISOString().slice(0, 10)}.zip`); toast.ok(n ? `已打包 ${n} 张图表` : '当前页没有图表'); };

  return (
    <div className="page" ref={box}>
      <Head n={agg.board.length} sel={sel} onCompare={() => go('compare', [], { e: sel.join('|') })} onExport={() => void exportAll()} />
      <div className="podium">
        {top.map((b, i) => {
          const { model, harness } = splitEntrant(b.entrant);
          return (
            <button key={b.entrant} className={cls('pod glass sheen', `p${i + 1}`)} onClick={() => go('models', [vendorOf(b.entrant) || '', model])}>
              <span className="sheen-l" aria-hidden />
              <span className="pod-rank">{i === 0 ? <Crown size={16} /> : null}{b.rank}</span>
              <ModelAvatar vendor={vendorOf(b.entrant)} model={model} size="lg" blind={nm.blind} />
              <div className="pod-n ellipsis">{nm.blind ? nm.entrant(b.entrant) : model}</div>
              <div className="muted xs row gap-s" style={{ justifyContent: 'center' }}><HarnessIcon name={harness} size="xs" />{harness}</div>
              <div className="pod-q">{fmt.n(b.quality)}</div>
              <div className="muted xs">{b.ci_low != null ? `CI ${fmt.n(b.ci_low)}–${fmt.n(b.ci_high)}` : '—'} · 达标 {fmt.pct(b.pass_rate)}</div>
            </button>
          );
        })}
      </div>

      <div className="toolbar-row mt-l">
        <Seg value={tab} onChange={setTab} options={[
          { value: 'board', label: '总榜' }, { value: 'dims', label: '维度' }, { value: 'tasks', label: '逐题' }, { value: 'eff', label: '效率' },
          { value: 'items', label: '检查项分析' }, { value: 'uplift', label: 'Skill 增益' }, { value: 'fail', label: '失败归因' },
        ]} />
        <span className="grow" />
        <span className="muted small">名次带 “=” 表示与上一名 95% 置信区间重叠（统计上并列）</span>
      </div>

      {tab === 'board' && (
        <>
          <Card pad={false} className="mt">
            <div className="tbl-wrap"><table className="tbl board-tbl">
              <thead><tr>
                <th style={{ width: 36 }} />{th('rank', '名次')}<th>参赛者</th>{th('quality', '质量分')}<th style={{ width: 160 }}>95% CI</th>
                {dims.map((d) => <th key={d.id} className="sortable num" onClick={() => setSort({ k: d.id, asc: sort.k === d.id ? !sort.asc : false })} style={{ color: `var(--d-${d.id})` }}>{d.name}</th>)}
                {th('pass', '达标率', 'num')}{th('cost', '期望成本', 'num')}{th('time', '期望用时', 'num')}<th />
              </tr></thead>
              <tbody>{board.map((b) => {
                const { model, harness } = splitEntrant(b.entrant);
                return (
                  <tr key={b.entrant} className={cls('clickable', sel.includes(b.entrant) && 'on')} onClick={() => toggle(b.entrant)} onMouseEnter={() => setHover(b.entrant)} onMouseLeave={() => setHover(null)}>
                    <td onClick={(e) => e.stopPropagation()}><CheckBox checked={sel.includes(b.entrant)} onChange={() => toggle(b.entrant)} label={`选择 ${b.entrant}`} /></td>
                    <td className="mono b">{b.rank}</td>
                    <td><span className="row gap-s"><ModelAvatar vendor={vendorOf(b.entrant)} model={model} size="sm" blind={nm.blind} dot={color(b.entrant)} /><span className="who-t"><b>{nm.blind ? nm.entrant(b.entrant) : model}</b><span>{harness}</span></span></span></td>
                    <td><Score v={b.quality} big /></td>
                    <td><CiBar v={b.quality} lo={b.ci_low} hi={b.ci_high} color={color(b.entrant)} /></td>
                    {dims.map((d) => <td key={d.id} className="num heat-td" style={{ background: heat(b.dims[d.id]) }}>{fmt.n(b.dims[d.id], 0)}</td>)}
                    <td className="num">{fmt.pct(b.pass_rate)}</td>
                    <td className="num">{fmt.usd(b.suite_exp_cost_usd)}</td>
                    <td className="num">{fmt.min(b.suite_exp_min)}</td>
                    <td>{!b.complete && <Badge tone="warn">不完整</Badge>}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          </Card>
          <div className="grid g-2 mt-l">
            <ChartCard title="维度雷达" sub={sel.length ? `已选 ${sel.length} 个参赛者` : '前 5 名'}>
              <div className="center"><Radar axes={dims.map((d) => ({ id: d.id, label: d.name }))} series={radarSeries} focus={hover} onFocus={setHover} /></div>
              <Legend items={radarSeries.map((s) => ({ key: s.key, label: s.label, color: s.color }))} onHover={setHover} active={hover} />
            </ChartCard>
            <ChartCard title="质量总分与置信区间" sub="点 = 均值，横线 = 95% CI">
              <QualityCi rows={agg.board} color={color} label={nm.entrant} />
            </ChartCard>
          </div>
        </>
      )}
      {tab === 'dims' && (
        <ChartCard title="参赛者 × 维度" sub="7 个质量维度得分" className="mt">
          <Heatmap rows={agg.board.map((b) => ({ id: b.entrant, label: nm.entrant(b.entrant) }))} cols={dims.map((d) => ({ id: d.id, label: d.name, color: `var(--d-${d.id})` }))} value={(r, c) => agg.board.find((b) => b.entrant === r)?.dims[c] ?? null} rowW={220} cell={76} />
        </ChartCard>
      )}
      {tab === 'tasks' && (
        <ChartCard title="参赛者 × 题目" sub="每题均值；点击格子查看该模型的运行" className="mt">
          <Heatmap rows={agg.board.map((b) => ({ id: b.entrant, label: nm.entrant(b.entrant) }))} cols={agg.tkeys.map((k) => ({ id: k, label: k }))} rowW={220} cell={64}
            value={(r, c) => agg.tasks.find((t) => t.entrant === r && t.task === c)?.mean ?? null}
            text={(r, c, v) => { const t = agg.tasks.find((x) => x.entrant === r && x.task === c); return v == null ? '·' : `${v.toFixed(0)}${t && t.sd > 0 ? '±' + t.sd.toFixed(0) : ''}`; }}
            onCell={(r, c) => { localStorage.setItem('wb.runs.model', JSON.stringify(`${nm.vendorOf(r) || ''}/${splitEntrant(r).model}`)); localStorage.setItem('wb.runs.task', JSON.stringify(c.slice(0, 3))); go('runs'); }} />
        </ChartCard>
      )}
      {tab === 'eff' && (
        <div className="grid g-2 mt">
          <ChartCard title="成本 × 质量（帕累托）" sub="越靠左上越好">
            <Pareto points={frontier(agg.board.filter((b) => b.quality != null && b.suite_exp_cost_usd != null).map((b) => ({ key: b.entrant, label: nm.entrant(b.entrant), x: b.suite_exp_cost_usd!, y: b.quality!, color: color(b.entrant) })))} />
          </ChartCard>
          <ChartCard title="用时 × 质量" sub="整套期望达标用时（分钟，对数）">
            <Pareto xLabel="整套期望用时（分钟，对数）" points={frontier(agg.board.filter((b) => b.quality != null && b.suite_exp_min != null).map((b) => ({ key: b.entrant, label: nm.entrant(b.entrant), x: b.suite_exp_min!, y: b.quality!, color: color(b.entrant) })))} />
          </ChartCard>
          <Card title="效率明细" className="span-all" pad={false}>
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>参赛者</th><th className="num">质量</th><th className="num">达标率</th><th className="num">整套期望成本</th><th className="num">整套期望用时</th><th>成本覆盖</th></tr></thead>
              <tbody>{agg.board.map((b) => <tr key={b.entrant}><td>{nm.entrant(b.entrant)}</td><td className="num"><Score v={b.quality} /></td><td className="num">{fmt.pct(b.pass_rate)}</td><td className="num">{fmt.usd(b.suite_exp_cost_usd)}</td><td className="num">{fmt.min(b.suite_exp_min)}</td><td className="small muted">{b.cost_coverage}</td></tr>)}</tbody>
            </table></div>
          </Card>
        </div>
      )}
      {tab === 'items' && (
        <Card title="检查项分析" sub="用于迭代题库：天花板 / 地板 / 区分度低的检查项在下一版调整" className="mt" pad={false}>
          <div className="tbl-wrap" style={{ maxHeight: 620 }}><table className="tbl compact">
            <thead><tr><th>题目</th><th>编号</th><th>检查内容</th><th>方式</th><th className="num">均值</th><th className="num">参赛者间 SD</th><th className="num">参赛者内 SD</th><th className="num">n</th><th>标记</th></tr></thead>
            <tbody>{agg.items.map((i) => <tr key={i.task + i.item_id}><td className="mono">{i.task}</td><td className="mono small">{i.item_id}</td><td className="small">{i.desc}</td><td className="small">{i.method}</td><td className="num">{fmt.n(i.mean * 100, 0)}</td><td className="num">{fmt.n(i.between_sd * 100, 0)}</td><td className="num">{fmt.n(i.within_sd * 100, 0)}</td><td className="num">{i.n}</td><td>{i.flag && <Badge tone="warn">{i.flag}</Badge>}</td></tr>)}</tbody>
          </table></div>
        </Card>
      )}
      {tab === 'uplift' && (
        <Card title="Skill 增益（T03 A/C 对照）" sub="C 组（HyperFrames skills）− A 组（纯手写）" className="mt" pad={false}>
          {!agg.uplift.length ? <Empty title="暂无 A/C 成对数据">同一参赛者需要同时有 T03A 与 T03C 的评分运行。</Empty> : (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>参赛者</th><th className="num">A 组</th><th className="num">C 组</th><th className="num">增益</th><th className="num">动画分增益</th><th className="num">费用 A / C</th><th className="num">用时 A / C</th></tr></thead>
              <tbody>{agg.uplift.map((u) => <tr key={u.entrant}><td>{nm.entrant(u.entrant)}</td><td className="num">{fmt.n(u.A_mean)}</td><td className="num">{fmt.n(u.C_mean)}</td><td className={cls('num b', u.uplift > 0 ? 'tone-text-ok' : 'tone-text-bad')}>{u.uplift > 0 ? '+' : ''}{fmt.n(u.uplift)}</td><td className="num">{fmt.n(u.anim_uplift)}</td><td className="num">{fmt.usd(u.A_cost)} / {fmt.usd(u.C_cost)}</td><td className="num">{fmt.min(u.A_min)} / {fmt.min(u.C_min)}</td></tr>)}</tbody>
            </table></div>
          )}
        </Card>
      )}
      {tab === 'fail' && (
        <Card title="失败归因" sub="门槛失败与未达标运行" className="mt" pad={false}>
          {!agg.failures.length ? <Empty title="没有失败运行" /> : (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>参赛者</th><th>题目</th><th>运行</th><th className="num">总分</th><th>归因</th></tr></thead>
              <tbody>{agg.failures.map((f) => <tr key={f.run_id} className="clickable" onClick={() => go('runs', [], { id: f.run_id })}><td>{nm.entrant(f.entrant)}</td><td className="mono">{f.task}</td><td className="mono small">{nm.blind ? '—' : f.run_id}</td><td className="num"><Score v={f.total} /></td><td className="small">{f.tags}</td></tr>)}</tbody>
            </table></div>
          )}
        </Card>
      )}
    </div>
  );
}

function Head({ n, sel = [], onCompare, onExport }: { n: number; sel?: string[]; onCompare?: () => void; onExport?: () => void }) {
  const wb = useWb();
  return (
    <div className="page-head">
      <div className="page-head-t">
        <div className="eyebrow">{wb.spec?.cfg.name} {wb.spec?.cfg.version} · {n} 个参赛者（模型 @ harness）</div>
        <h1 className="page-title">排行榜</h1>
        <p className="page-sub">质量总分 = 7 个质量维度按权重合成；成本与速度单独列出，不混入质量分。评分规则见 <a href="#/docs/scoring">方法论</a>。</p>
      </div>
      {n > 0 && <div className="page-x">
        <Btn icon={<Download size={15} />} onClick={onExport}>导出本页图表</Btn>
        <Btn icon={<PackageOpen size={15} />} onClick={() => go('exports')}>导出中心</Btn>
        <Btn tone="primary" icon={<GitCompareArrows size={15} />} disabled={sel.length < 2} onClick={onCompare}>{sel.length >= 2 ? `对比所选 ${sel.length} 个` : '勾选 2 个以上对比'}</Btn>
      </div>}
    </div>
  );
}

function QualityCi({ rows, color, label }: { rows: BoardRow[]; color: (e: string) => string; label: (e: string) => string }) {
  const W = 620, rh = 30, L = 170, R = 44, H = rows.length * rh + 30;
  const X = (v: number) => L + (v / 100) * (W - L - R);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="质量总分与置信区间">
      {[0, 20, 40, 60, 80, 100].map((v) => <g key={v}><line x1={X(v)} x2={X(v)} y1={4} y2={H - 22} className="grid" /><text x={X(v)} y={H - 6} textAnchor="middle" className="tick">{v}</text></g>)}
      {rows.map((b, i) => {
        const y = 8 + i * rh + rh / 2;
        return (
          <g key={b.entrant}>
            <text x={L - 12} y={y} textAnchor="end" dominantBaseline="middle" className="tick b">{label(b.entrant).slice(0, 24)}</text>
            {b.ci_low != null && b.ci_high != null && <line x1={X(b.ci_low)} x2={X(b.ci_high)} y1={y} y2={y} stroke={color(b.entrant)} strokeWidth={6} strokeLinecap="round" opacity={0.35} />}
            {b.quality != null && <circle cx={X(b.quality)} cy={y} r={6.5} fill={color(b.entrant)} stroke="var(--bg)" strokeWidth={2} />}
            <text x={W - R + 8} y={y} dominantBaseline="middle" className="val">{fmt.n(b.quality)}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** 标记帕累托前沿：没有别的点同时更便宜且更好 */
export function frontier<T extends { x: number; y: number }>(pts: T[]): (T & { frontier: boolean })[] {
  return pts.map((p) => ({ ...p, frontier: !pts.some((q) => q !== p && q.x <= p.x && q.y >= p.y && (q.x < p.x || q.y > p.y)) }));
}
