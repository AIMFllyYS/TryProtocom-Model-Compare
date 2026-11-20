import type { Aggregate, EffMetric } from '../../shared/types';
import { fmt } from '../lib/format';
import { modelImageLabel } from '../lib/modelImageLabel';
import { scoreBand } from '../lib/boardScores';
import { useNamer } from './common';

export const EFFICIENCY_SECTION = '速度与价格权衡';
export const USD_TO_CNY = 6.8;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const number = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
const money = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const precise = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const minutes = (value: number | null | undefined) => finite(value) ? number.format(value) : '—';
function yuan(value: number | null | undefined) {
  if (!finite(value)) return '—';
  const amount = value * USD_TO_CNY;
  if (amount > 0 && amount < .0001) return '<¥0.0001';
  return `¥${(amount > 0 && amount < 1 ? precise : money).format(amount)}`;
}
const relative = (value: number | null | undefined) => finite(value) ? `${precise.format(value)}×` : '—';
const uncertainty = (metric?: EffMetric) => finite(metric?.unc) ? `±${Math.round(metric.unc * 100)}%${metric.level ? ' · ' + metric.level : ''}` : '—';

function coverage(metric?: EffMetric, time = false) {
  if (!metric?.tasks_total) return '—';
  const flags = time ? [metric.excluded && `排除 ${metric.excluded}`, metric.pending && `待核实 ${metric.pending}`].filter(Boolean) : [];
  return [`${metric.tasks} / ${metric.tasks_total} 题`, ...flags].join(' · ');
}

export function EfficiencyExportTables({ agg }: { agg: Aggregate }) {
  const nm = useNamer();
  const baselineValues = Object.values(agg.eff_baseline?.time ?? {}).filter(finite);
  const baseline = baselineValues.length ? baselineValues.reduce((sum, value) => sum + value, 0) : null;
  const data = agg.board.map((row) => ({
    row, time: agg.eff?.[row.entrant]?.time, cost: agg.eff?.[row.entrant]?.cost,
  }));
  return <>{(['time', 'cost'] as const).map((mode) => {
    const speed = mode === 'time';
    const rankingValue = (entry: (typeof data)[number]) => speed ? entry.time?.mean : entry.cost?.rel;
    const sort = [...data].sort((a, b) => {
      const left = rankingValue(a), right = rankingValue(b);
      if (finite(left) && finite(right) && left !== right) return left - right;
      if (finite(left) !== finite(right)) return finite(left) ? -1 : 1;
      return (b.row.quality ?? -1) - (a.row.quality ?? -1);
    });
    const ranked = sort.filter((entry) => finite(rankingValue(entry)));
    const missing = sort.slice(ranked.length);
    const columns = speed
      ? ['排名', '参赛者', '质量分', '每题平均用时（分钟）', '整套预计用时（分钟）', '整套较基线（分钟）', '用时覆盖', '不确定性', '整套估算费用（元）']
      : ['排名', '参赛者', '质量分', '整套估算费用（元）', '相对价格', '每题平均（元）', '费用覆盖', '不确定性', '整套预计用时（分钟）'];
    const render = ({ row, time, cost }: (typeof data)[number], rank?: number) => {
      const estimate = time?.suite_est;
      const delta = baseline != null && finite(estimate) ? Math.round((estimate - baseline) * 100) / 100 || 0 : null;
      const label = nm.entrant(row.entrant);
      return <tr key={row.entrant} data-export-row={rank == null ? 'unranked' : undefined}>
        <td className="center">{rank ?? '—'}</td>
        <td data-export-model={JSON.stringify(modelImageLabel(row, nm.blind ? label : undefined))}>{label}</td>
        <td data-board-score={scoreBand(row.quality) ?? 'none'}>{fmt.n(row.quality)}</td>
        {speed ? <>
          <td className="num" data-export-emphasis={rank != null ? 'primary' : undefined}>{minutes(time?.mean)}</td>
          <td className="num" data-export-nowrap>{minutes(estimate)}</td>
          <td className="num" data-export-nowrap>{delta == null ? '—' : `${delta > 0 ? '+' : ''}${minutes(delta)}`}</td>
          <td className="num">{coverage(time, true)}</td>
          <td className="num" data-export-nowrap>{uncertainty(time)}</td>
          <td className="num" data-export-emphasis="secondary">{yuan(cost?.suite_est)}</td>
        </> : <>
          <td className="num" data-export-emphasis={rank != null ? 'primary' : undefined}>{yuan(cost?.suite_est)}</td>
          <td className="num" data-export-nowrap>{relative(cost?.rel)}</td>
          <td className="num" data-export-nowrap>{yuan(cost?.mean)}</td>
          <td className="num">{coverage(cost)}</td>
          <td className="num" data-export-nowrap>{uncertainty(cost)}</td>
          <td className="num" data-export-emphasis="secondary">{minutes(estimate)}</td>
        </>}
      </tr>;
    };
    return <table key={mode} className="tbl efficiency-export-table" data-eff-export={mode} data-comparable={ranked.length} data-participants={data.length}>
      <thead><tr>{columns.map((name, index) => <th key={name} className={index === 1 ? undefined : 'num'}
        data-export-emphasis={index === 3 ? 'primary' : index === columns.length - 1 ? 'secondary' : undefined}>{name}</th>)}</tr></thead>
      <tbody>
        {ranked.map((entry, index) => render(entry, index + 1))}
        {!!missing.length && <tr data-export-row="separator">
          <td colSpan={columns.length}>{speed ? '暂无可比用时' : '暂无可比费用'} · {missing.length} 条 · 按质量分降序</td>
        </tr>}
        {missing.map((entry) => render(entry))}
      </tbody>
    </table>;
  })}</>;
}
