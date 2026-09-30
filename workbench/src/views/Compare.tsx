// 对比：选 2–6 个参赛者，叠加雷达、逐题分组柱、维度差值与胜负、效率散点；整页图表一键打包导出。
import { useMemo, useRef, useState } from 'react';
import { Download, GitCompareArrows, Plus, X } from 'lucide-react';
import { useWb } from '../state';
import { go, useRoute } from '../lib/router';
import { cls, fmt, splitEntrant } from '../lib/format';
import { exportAllCharts } from '../lib/exporter';
import { Btn, Card, Empty, Select } from '../ui/kit';
import { Bars, ChartCard, Legend, Pareto, Radar, seriesColor } from '../ui/charts';
import { ModelAvatar } from '../ui/brand';
import { toast } from '../ui/toast';
import { Score, useNamer } from '../components/common';
import { frontier } from './Board';

export default function Compare() {
  const wb = useWb();
  const nm = useNamer();
  const route = useRoute();
  const box = useRef<HTMLDivElement>(null);
  const agg = wb.agg;
  const all = agg?.board || [];
  const fromUrl = (route.query.get('e') || '').split(/[|,]/).map((s) => s.trim()).filter(Boolean);
  const initial = fromUrl.filter((e) => all.some((b) => b.entrant === e || b.entrant.toLowerCase().includes(e.toLowerCase())))
    .map((e) => all.find((b) => b.entrant === e)?.entrant || all.find((b) => b.entrant.toLowerCase().includes(e.toLowerCase()))!.entrant);
  const [picked, setPicked] = useState<string[]>(initial.length ? initial : all.slice(0, Math.min(3, all.length)).map((b) => b.entrant));
  const [hover, setHover] = useState<string | null>(null);
  const setP = (p: string[]) => { setPicked(p); go('compare', [], { e: p.join('|') }, true); };
  const rows = picked.map((e) => all.find((b) => b.entrant === e)!).filter(Boolean);
  const color = (e: string) => seriesColor(Math.max(0, picked.indexOf(e)));
  const dims = (wb.spec?.dims || []).filter((d) => d.kind === 'quality');
  const tkeys = agg?.tkeys || [];
  const taskMean = (e: string, k: string) => agg?.tasks.find((t) => t.entrant === e && t.task === k);
  const wins = useMemo(() => {
    const w = new Map<string, number>();
    for (const k of tkeys) {
      const best = rows.map((r) => ({ e: r.entrant, v: taskMean(r.entrant, k)?.mean })).filter((x) => x.v != null).sort((a, b) => b.v! - a.v!)[0];
      if (best) w.set(best.e, (w.get(best.e) || 0) + 1);
    }
    return w;
  }, [rows, tkeys, agg]); // eslint-disable-line

  if (!agg) return <div className="page"><div className="skel" style={{ height: 400 }} /></div>;
  if (all.length < 2) return <div className="page"><Head /><Card><Empty icon={<GitCompareArrows size={30} />} title="至少需要 2 个有评分的参赛者" action={<Btn onClick={() => go('board')}>查看排行榜</Btn>}>完成更多模型的评分后即可对比。</Empty></Card></div>;
  const add = all.filter((b) => !picked.includes(b.entrant));
  const exportAll = async () => { const n = await exportAllCharts(box.current!, `compare-${rows.map((r) => splitEntrant(r.entrant).model).join('-vs-').slice(0, 80)}.zip`); toast.ok(`已打包 ${n} 张图表`); };
  const lead = (d: string) => { const vs = rows.map((r) => r.dims[d]).filter((v): v is number => v != null); return vs.length ? Math.max(...vs) : null; };

  return (
    <div className="page" ref={box}>
      <Head onExport={() => void exportAll()} />
      <div className="cmp-pick glass-thin">
        {rows.map((r) => {
          const { model, harness } = splitEntrant(r.entrant);
          return (
            <span key={r.entrant} className="cmp-chip" style={{ ['--c' as string]: color(r.entrant) }}>
              <ModelAvatar vendor={nm.vendorOf(r.entrant)} model={model} size="sm" blind={nm.blind} dot={color(r.entrant)} />
              <span className="who-t"><b>{nm.blind ? nm.entrant(r.entrant) : model}</b><span>{harness} · #{r.rank} · {fmt.n(r.quality)}</span></span>
              <button className="icon-btn xs" aria-label="移除" onClick={() => setP(picked.filter((x) => x !== r.entrant))}><X size={12} /></button>
            </span>
          );
        })}
        {add.length > 0 && picked.length < 6 && (
          <Select value="" onChange={(e) => setP([...picked, e])} placeholder="添加参赛者" size="sm" searchable render={() => <span className="row gap-s"><Plus size={14} />添加参赛者</span>}
            options={add.map((b) => ({ value: b.entrant, label: nm.entrant(b.entrant), desc: `#${b.rank} · ${fmt.n(b.quality)}`, icon: <ModelAvatar vendor={nm.vendorOf(b.entrant)} model={splitEntrant(b.entrant).model} size="xs" blind={nm.blind} /> }))} />
        )}
      </div>

      {rows.length < 2 ? <Card className="mt"><Empty title="再选一个参赛者" /></Card> : (
        <>
          <div className="grid g-4 mt-l">
            {rows.map((r) => (
              <div key={r.entrant} className="cmp-kpi glass" style={{ ['--c' as string]: color(r.entrant) }}>
                <div className="row gap-s"><i className="cmp-bar" /><b className="ellipsis">{nm.entrant(r.entrant)}</b></div>
                <div className="row" style={{ alignItems: 'baseline' }}><span className="big-num">{fmt.n(r.quality)}</span><span className="muted small">#{r.rank}</span></div>
                <div className="muted xs">领先 {wins.get(r.entrant) || 0}/{tkeys.length} 题 · 达标 {fmt.pct(r.pass_rate)} · {fmt.usd(r.suite_exp_cost_usd)} · {fmt.min(r.suite_exp_min)}</div>
              </div>
            ))}
          </div>
          <div className="grid g-2 mt-l">
            <ChartCard title="维度雷达对比" sub={rows.map((r) => splitEntrant(r.entrant).model).join(' vs ')}>
              <div className="center"><Radar axes={dims.map((d) => ({ id: d.id, label: d.name }))} series={rows.map((r) => ({ key: r.entrant, label: nm.entrant(r.entrant), color: color(r.entrant), values: r.dims }))} focus={hover} onFocus={setHover} /></div>
              <Legend items={rows.map((r) => ({ key: r.entrant, label: nm.entrant(r.entrant), color: color(r.entrant) }))} onHover={setHover} active={hover} />
            </ChartCard>
            <ChartCard title="成本 × 质量" sub="整套期望成本（美元，对数）">
              <Pareto points={frontier(rows.filter((b) => b.quality != null && b.suite_exp_cost_usd != null).map((b) => ({ key: b.entrant, label: nm.entrant(b.entrant), x: b.suite_exp_cost_usd!, y: b.quality!, color: color(b.entrant) })))} />
            </ChartCard>
            <ChartCard title="逐题得分对比" sub="均值 ± 标准差" className="span-all">
              <Bars cats={tkeys.map((k) => ({ id: k, label: k }))} series={rows.map((r) => ({ key: r.entrant, label: nm.entrant(r.entrant), color: color(r.entrant), values: Object.fromEntries(tkeys.map((k) => [k, taskMean(r.entrant, k)?.mean ?? null])), err: Object.fromEntries(tkeys.map((k) => [k, taskMean(r.entrant, k)?.sd ?? null])) }))} height={300} />
              <Legend items={rows.map((r) => ({ key: r.entrant, label: nm.entrant(r.entrant), color: color(r.entrant) }))} />
            </ChartCard>
          </div>
          <Card title="维度明细" sub="每行最高分加粗；Δ = 相对第一列" className="mt-l" pad={false}>
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>维度</th>{rows.map((r, i) => <th key={r.entrant} className="num" style={{ color: color(r.entrant) }}>{nm.entrant(r.entrant)}{i > 0 && ' (Δ)'}</th>)}</tr></thead>
              <tbody>
                {[{ id: '__q', name: '质量总分' }, ...dims].map((d) => {
                  const get = (r: typeof rows[number]) => d.id === '__q' ? r.quality : r.dims[d.id];
                  const best = d.id === '__q' ? Math.max(...rows.map((r) => r.quality ?? -1)) : lead(d.id);
                  const base = get(rows[0]);
                  return (
                    <tr key={d.id} className={cls(d.id === '__q' && 'b')}>
                      <td><span className="row gap-s">{d.id !== '__q' && <i className="dot" style={{ width: 8, height: 8, borderRadius: 4, background: `var(--d-${d.id})` }} />}{d.name}</span></td>
                      {rows.map((r, i) => { const v = get(r); const delta = i > 0 && v != null && base != null ? v - base : null; return <td key={r.entrant} className={cls('num', v != null && v === best && 'b')}>{fmt.n(v)}{delta != null && <span className={cls('xs', delta > 0 ? 'tone-text-ok' : delta < 0 ? 'tone-text-bad' : 'muted')}> {delta > 0 ? '+' : ''}{delta.toFixed(1)}</span>}</td>; })}
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          </Card>
          <Card title="逐题明细" sub="均值 ± 标准差 · 达标率" className="mt-l" pad={false}>
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>题目</th>{rows.map((r) => <th key={r.entrant} className="num" style={{ color: color(r.entrant) }}>{nm.entrant(r.entrant)}</th>)}</tr></thead>
              <tbody>{tkeys.map((k) => {
                const vals = rows.map((r) => taskMean(r.entrant, k)?.mean ?? null);
                const best = Math.max(...vals.map((v) => v ?? -1));
                return <tr key={k}><td className="mono b">{k}</td>{rows.map((r, i) => { const t = taskMean(r.entrant, k); return <td key={r.entrant} className={cls('num', vals[i] != null && vals[i] === best && 'b')}>{t ? <><Score v={t.mean} /> <span className="muted xs">±{fmt.n(t.sd, 0)} · {fmt.pct(t.pass_rate)}</span></> : '—'}</td>; })}</tr>;
              })}</tbody>
            </table></div>
          </Card>
        </>
      )}
    </div>
  );
}

function Head({ onExport }: { onExport?: () => void }) {
  return (
    <div className="page-head">
      <div className="page-head-t">
        <h1 className="page-title">对比</h1>
        <p className="page-sub">选择 2–6 个参赛者（模型 @ harness），逐维度、逐题查看差异。在排行榜勾选后点「对比所选」也会来到这里。</p>
      </div>
      {onExport && <div className="page-x"><Btn icon={<Download size={15} />} onClick={onExport}>打包导出全部图表</Btn></div>}
    </div>
  );
}
