// 排行榜：领奖台 + 可排序总榜（勾选即对比）+ 维度 / 逐题热力 + 效率帕累托 + 检查项分析 + Skill 增益 + 失败归因。
import { useMemo, useRef, useState, type MouseEvent } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { ArrowDownUp, Crown, Download, GitCompareArrows, ImageDown, ListFilter, PackageOpen, Trophy } from 'lucide-react';
import { BOARD_VIEWS, type Aggregate, type BoardRow } from '../../shared/types';
import { useWb } from '../state';
import { go, useLocal } from '../lib/router';
import { cls, fmt, splitEntrant } from '../lib/format';
import { exportAllCharts } from '../lib/exporter';
import { Badge, Btn, Card, CheckBox, Empty, Seg } from '../ui/kit';
import { ChartCard, CiBar, Heatmap, Legend, Pareto, Radar } from '../ui/charts';
import { HarnessIcon, ModelAvatar } from '../ui/brand';
import { HARNESS_GROUPS, harnessGroup } from '../../shared/vendors';
import { toast } from '../ui/toast';
import { Score, useNamer } from '../components/common';
import { EffTable, radarAxes, TimeReviewList } from '../components/Efficiency';
import { BoardModelPicker } from '../components/BoardModelPicker';
import { EFFICIENCY_SECTION, EfficiencyExportTables, USD_TO_CNY } from '../components/EfficiencyExportTables';
import { boardModelIndex, modelKey, type ModelSelection } from '../lib/boardModels';
import { picturePanels, saveBoardImage, saveEfficiencyImages } from '../lib/boardImage';
import { modelImageLabel } from '../lib/modelImageLabel';
import { SCORE_BANDS, scoreBand } from '../lib/boardScores';
import { analyzeItems } from '../../shared/itemAnalysis';
import { applyView, suiteOfRun } from '../../shared/v2';
import '../styles/board.css';

type Tab = 'board' | 'dims' | 'tasks' | 'eff' | 'items' | 'uplift' | 'fail';
type SortK = 'rank' | 'quality' | 'pass' | 'cost' | 'time' | string;

const TABS: { value: Tab; label: string }[] = [
  { value: 'board', label: '总榜' }, { value: 'dims', label: '维度' }, { value: 'tasks', label: '逐题' }, { value: 'eff', label: '效率' },
  { value: 'items', label: '检查项分析' }, { value: 'uplift', label: 'Skill 增益' }, { value: 'fail', label: '失败归因' },
];
const tabName = (tab: Tab) => TABS.find((t) => t.value === tab)!.label;
type ExportTarget = { tab: Tab; section?: string };
type Picker = { kind: 'filter' } | ({ kind: 'export' } & ExportTarget);
type Data = { agg: Aggregate; sorted: BoardRow[] };

function sectionName(section: HTMLElement) {
  return section.dataset.boardSection || section.querySelector<HTMLElement>('[data-chart]')?.dataset.chart ||
    section.querySelector('.card-t')?.firstChild?.textContent?.trim();
}

export default function Board({ toolbar }: { toolbar: HTMLDivElement | null }) {
  const wb = useWb();
  const nm = useNamer();
  const [tab, setTab] = useLocal<Tab>('board.tab', 'board');
  const [sel, setSel] = useLocal<string[]>('board.sel', []);
  const [filter, setFilter] = useLocal<ModelSelection>('board.models', null);
  const [onlyN1, setOnlyN1] = useLocal<boolean>('board.n1', false);
  const [sort, setSort] = useState<{ k: SortK; asc: boolean }>({ k: 'rank', asc: true });
  const [picker, setPicker] = useState<Picker | null>(null);
  const [exportFilter, setExportFilter] = useState<ModelSelection>(null);
  const [capture, setCapture] = useState<ExportTarget | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const filterButton = useRef<HTMLButtonElement>(null);
  const captureBox = useRef<HTMLDivElement>(null);
  const { agg, view, spec, store } = wb;
  const index = useMemo(() => boardModelIndex(store?.models ?? [], agg?.board ?? [], store?.runs ?? [], spec?.tasks ?? [], view), [agg?.board, store, spec?.tasks, view]);
  const profileKeys = useMemo(() => new Set(store?.models.map((m) => modelKey(m.vendor, m.name))), [store?.models]);
  const blindKeys = useMemo(() => index.models.map((m) => m.key).sort(), [index.models]);
  const modelName = (vendor: string, name: string) => !nm.blind || profileKeys.has(modelKey(vendor, name))
    ? nm.model(vendor, name) : '历史模型 ' + (blindKeys.indexOf(modelKey(vendor, name)) + 1);
  const n1 = view === 'simple' && onlyN1;
  const available = useMemo(() => {
    const eligible = new Set((agg?.board || []).filter((r) => !n1 || r.n_max === 1).map((b) => b.entrant));
    for (const r of agg?.excluded || []) eligible.add(r.entrant);
    const keys = new Set([...eligible].map((e) => index.entrantKeys.get(e)));
    return index.models.filter((m) => keys.has(m.key));
  }, [agg, index, n1]);
  const selectData = (selection: ModelSelection, forTab: Tab): Data | null => {
    if (!agg) return null;
    const selected = selection && new Set(selection);
    const matches = (entrant: string) => {
      const key = index.entrantKeys.get(entrant);
      return !selected || (key != null && selected.has(key));
    };
    const board = agg.board.filter((r) => (!n1 || r.n_max === 1) && matches(r.entrant));
    const entrants = new Set(board.map((r) => r.entrant));
    const included = <T extends { entrant: string }>(rows: T[]) => rows.filter((r) => entrants.has(r.entrant));
    let items = agg.items;
    if (forTab === 'items' && board.length !== agg.board.length && store && spec) {
      const candidate = store.runs.filter((r) => r.graded && r.score && entrants.has(r.entrant));
      items = analyzeItems(applyView(candidate, view, { ...spec.cfg, ...spec.config_full }, spec.tasks).runs);
    }
    const metric = (value: number | null) => value != null && Number.isFinite(Number(value)) ? Number(value) : Infinity;
    const val = (r: BoardRow): number => sort.k === 'rank' ? parseFloat(r.rank) || 999 : sort.k === 'quality' ? r.quality ?? -1
      : sort.k === 'pass' ? r.pass_rate : sort.k === 'cost' ? metric(r.suite_exp_cost_usd)
      : sort.k === 'time' ? metric(r.suite_exp_min) : r.dims[sort.k] ?? -1;
    const sorted = [...board].sort((a, b) => (val(a) - val(b)) * (sort.asc ? 1 : -1));
    return { sorted, agg: { ...agg, board, items, excluded: agg.excluded?.filter((r) => matches(r.entrant)), tasks: included(agg.tasks), uplift: included(agg.uplift), failures: included(agg.failures) } };
  };
  const data = selectData(filter, tab);
  const scopeSel = sel.filter((e) => data?.agg.board.some((b) => b.entrant === e));
  const toggle = (e: string) => setSel((previous) => previous.includes(e) ? previous.filter((x) => x !== e) : [...previous, e].slice(-6));
  const openExport = (target: ExportTarget, event?: MouseEvent) => {
    event?.preventDefault();
    const current = new Set(available.map((m) => m.key));
    setExportFilter(filter?.filter((key) => current.has(key)) ?? null);
    setPicker({ kind: 'export', ...target });
  };
  const exportName = picker?.kind === 'export' ? picker.section || tabName(picker.tab) : undefined;
  const save = async () => {
    if (picker?.kind !== 'export' || !exportName) return;
    try {
      flushSync(() => setCapture(picker));
      const root = captureBox.current!;
      const viewLabel = BOARD_VIEWS.find((v) => v.id === view)?.label;
      const count = exportFilter === null ? available.length : exportFilter.length;
      const scope = `${viewLabel} · 已选 ${count} 个模型${n1 ? ' · 仅 n=1' : ''}`;
      if (picker.section === EFFICIENCY_SECTION) {
        await saveEfficiencyImages(root, EFFICIENCY_SECTION, scope, USD_TO_CNY);
        toast.ok('速度榜与价格榜已打包');
        return;
      }
      const section = picker.section || (picker.tab === 'board' ? '总榜' : undefined);
      const target = section ? [...root.querySelectorAll<HTMLElement>('[data-board-section], section.card')].find((el) => sectionName(el) === section)
        ?? (picker.section ? undefined : root) : root;
      const panels = target ? picturePanels(target, exportName) : [];
      if (!panels.length) throw new Error('所选模型在这张榜单中没有可导出数据');
      await saveBoardImage(panels, exportName, scope);
      toast.ok('已导出榜单高清图片');
    } finally {
      setCapture(null);
    }
  };
  const exportAll = async () => {
    if (!box.current) return;
    try {
      const n = await exportAllCharts(box.current, `leaderboard-charts-${new Date().toISOString().slice(0, 10)}.zip`);
      toast.ok(n ? `已打包 ${n} 张图表` : '当前页没有图表');
    } catch (error) { toast.error(error instanceof Error ? error.message : '导出图表失败'); }
  };

  const toolbarFilter = toolbar && createPortal(
    <Btn ref={filterButton} className="board-filter-trigger" size="sm" tone={filter === null || picker ? 'default' : 'tinted'} aria-haspopup="dialog"
      aria-expanded={!!picker} aria-controls={picker ? 'board-model-picker' : undefined}
      aria-label="筛选模型" icon={<ListFilter size={15} />} onClick={() => setPicker(picker?.kind === 'filter' ? null : { kind: 'filter' })}>
      <span className="board-filter-label">筛选模型</span>{filter !== null && <span className="board-filter-count">{index.models.filter((m) => filter.includes(m.key)).length}</span>}
    </Btn>, toolbar);
  const renderedExport = capture && selectData(exportFilter, capture.tab);
  return (
    <div className="page" ref={box}>
      {toolbarFilter}
      <Head n={data?.agg.board.length ?? 0} sel={scopeSel} onCompare={() => go('compare', [], { e: scopeSel.join('|') })}
        onExport={() => void exportAll()} onlyN1={onlyN1} setOnlyN1={setOnlyN1} />
      {!data || (agg?.view && agg.view !== view) ? <div className="skel" style={{ height: 400 }} /> : <>
        <Podium rows={data.agg.board.slice(0, 3)} />
        <div className="toolbar-row board-tab-tools">
          <Seg value={tab} label="排行榜类型" options={TABS} onChange={setTab} onOptionContextMenu={(nextTab, event) => openExport({ tab: nextTab }, event)} />
          <Btn size="sm" icon={<ImageDown size={15} />} onClick={() => openExport({ tab })} disabled={!available.length}>导出图片</Btn>
          {tab === 'board' && <span className="muted small board-rank-note">名次带 “=” 表示 95% 置信区间重叠</span>}
        </div>
        {data.agg.board.length === 0 && <Card className="mt"><Empty icon={<Trophy size={26} />}
          title={filter !== null || n1 ? '当前筛选没有参赛者' : view === 'full' ? '还没有参赛者测满 v2 全部题目' : '还没有评分结果'}
          action={filter !== null ? <Btn onClick={() => setFilter(null)}>显示全部模型</Btn>
            : !n1 ? <Btn tone="primary" onClick={() => go('tasks')}>查看题目</Btn> : undefined}>
          {filter !== null ? '调整筛选可查看其他模型。' : n1 ? '取消「只看 n=1」可查看所有样本。' : view === 'full' ? '完整榜仅收录每道 v2 题都测满 3 次的参赛者。' : undefined}
        </Empty></Card>}
        <div onContextMenu={(event) => {
          if (!(event.target instanceof Element)) return;
          const element = event.target.closest<HTMLElement>('[data-board-section]') || event.target.closest<HTMLElement>('section.card');
          const section = element && sectionName(element);
          if (section && element && (section === EFFICIENCY_SECTION || picturePanels(element, section).length)) openExport({ tab, section }, event);
        }}>
          <BoardContents data={data} tab={tab} sort={sort} setSort={setSort} sel={scopeSel} toggle={toggle}
            exportEfficiency={() => openExport({ tab, section: EFFICIENCY_SECTION })} />
        </div>
      </>}
      {picker && <BoardModelPicker key={picker.kind === 'export' ? exportName : 'filter'} anchor={filterButton} models={picker.kind === 'export' ? available : index.models}
        value={picker.kind === 'export' ? exportFilter : filter} onChange={picker.kind === 'export' ? setExportFilter : setFilter}
        onClose={() => setPicker(null)} blind={nm.blind} modelName={modelName} exportName={exportName}
        pairedExport={picker.kind === 'export' && picker.section === EFFICIENCY_SECTION}
        onExport={picker.kind === 'export' ? save : undefined} canExport={!!available.length && (exportFilter === null || exportFilter.length > 0)} />}
      {capture && renderedExport && createPortal(
        <div className="board-export-source" ref={captureBox} aria-hidden="true" inert>
          {capture.section === EFFICIENCY_SECTION ? <EfficiencyExportTables agg={renderedExport.agg} />
            : <BoardContents data={renderedExport} tab={capture.tab} sort={sort} sel={[]} />}
        </div>, document.body)}
    </div>
  );
}

function Podium({ rows }: { rows: BoardRow[] }) {
  const { view } = useWb();
  const nm = useNamer();
  if (!rows.length) return null;
  return (
    <div className="podium">
      {rows.map((b) => (
        <button key={b.entrant} className={cls('pod glass sheen', `p${Math.min(3, parseInt(b.rank, 10) || 3)}`)}
          onClick={() => go('models', [b.vendor || '', b.model])}>
          <span className="sheen-l" aria-hidden />
          <span className="pod-rank">{b.rank.startsWith('1') && parseInt(b.rank, 10) === 1 ? <Crown size={16} /> : null}{b.rank}</span>
          <ModelAvatar vendor={b.vendor} model={b.model} size="lg" blind={nm.blind} />
          <div className="pod-n ellipsis">{nm.blind ? nm.entrant(b.entrant) : b.model}</div>
          {!nm.blind && <div className="muted xs row gap-s" style={{ justifyContent: 'center' }}><HarnessIcon name={b.harness} size="xs" />{b.harness}</div>}
          <div className="pod-q">{fmt.n(b.quality)}</div>
          <div className="muted xs">{b.ci_low != null ? `CI ${fmt.n(b.ci_low)}–${fmt.n(b.ci_high)}` : '—'} · 达标 {fmt.pct(b.pass_rate)}{view === 'simple' && b.n_max != null ? ` · n=${nRange(b)}` : ''}</div>
        </button>
      ))}
    </div>
  );
}

function BoardScoreLegend() {
  return <div className="board-score-legend" aria-label="分数段">
    <span>分数段</span>
    {SCORE_BANDS.map((band) => <span key={band.min} data-board-score={band.min}>{band.label}</span>)}
    <span data-board-score="none">— 无数据</span>
  </div>;
}

function BoardContents({ data, tab, sort, setSort, sel, toggle, exportEfficiency }: {
  data: Data; tab: Tab; sort: { k: SortK; asc: boolean }; setSort?: (sort: { k: SortK; asc: boolean }) => void;
  sel: string[]; toggle?: (entrant: string) => void; exportEfficiency?: () => void;
}) {
  const wb = useWb();
  const nm = useNamer();
  const [hover, setHover] = useState<string | null>(null);
  const { agg, sorted: board } = data;
  const view = wb.view;
  const dims = (wb.spec?.dims || []).filter((d) => d.kind === 'quality' && (!d.only_views || d.only_views.includes(view)));
  const byEntrant = new Map(agg.board.map((b) => [b.entrant, b]));
  const th = (k: SortK, label: string, cls2 = '') => <th className={cls('sortable', cls2)} onClick={() => setSort?.({ k, asc: sort.k === k ? !sort.asc : k === 'rank' || k === 'cost' || k === 'time' })}>{label}{sort.k === k && <ArrowDownUp size={11} style={{ display: 'inline', marginLeft: 3, opacity: .6 }} />}</th>;
  const color = nm.color;
  const exportRow = (r: { entrant: string; model: string; harness?: string; vendor?: string | null }) =>
    modelImageLabel(r, nm.blind ? nm.entrant(r.entrant) : undefined, color(r.entrant));
  const exportByEntrant = (entrant: string) => exportRow(byEntrant.get(entrant) ?? { entrant, ...splitEntrant(entrant) });
  const modelLabels = agg.board.map(exportRow);
  const excludedCodes = wb.agg?.excluded?.map((r) => r.entrant).sort();
  const excludedLabel = (entrant: string) => nm.blind ? `未入榜参赛者 ${(excludedCodes?.indexOf(entrant) ?? -1) + 1}` : entrant;
  const excludedExport = (entrant: string) => modelImageLabel(wb.store?.runs.find((r) => r.entrant === entrant) ?? splitEntrant(entrant),
    nm.blind ? excludedLabel(entrant) : undefined);
  const costRows = agg.board.filter((b) => b.quality != null && b.suite_exp_cost_usd != null && Number.isFinite(Number(b.suite_exp_cost_usd)));
  const timeRows = agg.board.filter((b) => b.quality != null && agg.eff?.[b.entrant]?.time.suite_est != null);
  const radarSeries = (sel.length ? agg.board.filter((b) => sel.includes(b.entrant)) : agg.board.slice(0, 5)).map((b) => ({ key: b.entrant, label: nm.entrant(b.entrant), color: color(b.entrant), values: b.dims }));
  if (!board.length) return <Excluded rows={agg.excluded} label={excludedLabel} modelLabel={excludedExport} />;
  return (
    <div className="board-panels">
      {tab === 'board' && (
        <>
          <div className="board-export-section" data-board-section="总榜">
            <BoardScoreLegend />
            <Card pad={false}>
            <div className="tbl-wrap"><table className="tbl board-tbl">
              <thead><tr>
                <th data-export-skip style={{ width: 36 }} />{th('rank', '名次')}<th>参赛者</th>{th('quality', '质量分')}<th style={{ width: 160 }}>95% CI</th>
                {dims.map((d) => <th key={d.id} className="sortable num" onClick={() => setSort?.({ k: d.id, asc: sort.k === d.id ? !sort.asc : false })} style={{ color: `var(--d-${d.id})` }}>{d.name}</th>)}
                {view === 'simple' && <th className="num" title="每题实际使用的运行次数">n</th>}{view === 'full' && <th className="num" title="可用率 = Tier0 通过的运行占比">可用率</th>}{th('pass', '达标率', 'num')}{th('cost', '期望成本', 'num')}{th('time', '期望用时', 'num')}<th data-export-text="状态" />
              </tr></thead>
              <tbody>{board.map((b) => {
                const { model, harness, vendor } = b;
                return (
                  <tr key={b.entrant} className={cls('clickable', sel.includes(b.entrant) && 'on')} onClick={() => toggle?.(b.entrant)} onMouseEnter={() => setHover(b.entrant)} onMouseLeave={() => setHover(null)}>
                    <td data-export-skip onClick={(e) => e.stopPropagation()}><CheckBox checked={sel.includes(b.entrant)} onChange={() => toggle?.(b.entrant)} label={`选择 ${nm.entrant(b.entrant)}`} /></td>
                    <td className="mono b" data-export-number>{b.rank}{view === 'simple' && b.star && <span title={`部分题目用了多次运行取最高（n=${nRange(b)}）`} className="tone-text-warn">*</span>}</td>
                    <td data-export-model={JSON.stringify(exportRow(b))}><span className="row gap-s"><ModelAvatar vendor={vendor} model={model} size="sm" blind={nm.blind} dot={color(b.entrant)} /><span className="who-t"><b>{nm.blind ? nm.entrant(b.entrant) : model}</b>{!nm.blind && <span title={`${HARNESS_GROUPS[harnessGroup(harness)].label}：${HARNESS_GROUPS[harnessGroup(harness)].hint}`}>{harness}</span>}</span></span></td>
                    <td className="board-quality" data-board-score={scoreBand(b.quality) ?? 'none'}>{fmt.n(b.quality)}</td>
                    <td data-export-number data-export-text={b.ci_low == null || b.ci_high == null ? '—' : fmt.n(b.ci_low) + '–' + fmt.n(b.ci_high)}><CiBar v={b.quality} lo={b.ci_low} hi={b.ci_high} color={color(b.entrant)} /></td>
                    {dims.map((d) => <td key={d.id} className="num heat-td" data-board-score={scoreBand(b.dims[d.id]) ?? 'none'}>{fmt.n(b.dims[d.id], 0)}</td>)}
                    {view === 'simple' && <td className="num mono">{nRange(b)}</td>}
                    {view === 'full' && <td className="num">{b.availability != null ? `${fmt.n(b.availability, 0)}%` : '—'}</td>}
                    <td className="num">{fmt.pct(b.pass_rate)}</td>
                    <td className="num">{fmt.usd(b.suite_exp_cost_usd)}</td>
                    <td className="num">{fmt.min(b.suite_exp_min)}</td>
                    <td>{!b.complete && <Badge tone="warn">不完整</Badge>}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>
            </Card>
          </div>
          <Excluded rows={agg.excluded} label={excludedLabel} modelLabel={excludedExport} />
          <div className="grid g-2 mt-l">
            <ChartCard title="维度雷达" exportModels={radarSeries.map((s) => exportByEntrant(s.key))} sub={sel.length ? `已选 ${sel.length} 个参赛者` : '前 5 名'}>
              <div className="center"><Radar axes={radarAxes(wb.spec?.dims, view)} series={radarSeries} focus={hover} onFocus={setHover} /></div>
              <Legend items={radarSeries.map((s) => ({ key: s.key, label: s.label, color: s.color }))} onHover={setHover} active={hover} />
            </ChartCard>
            <ChartCard title="质量总分与置信区间" exportModels={modelLabels} sub="点 = 均值，横线 = 95% CI">
              <QualityCi rows={agg.board} color={color} label={nm.entrant} />
            </ChartCard>
          </div>
          <EffTable rows={board} onExport={exportEfficiency} />
          {(agg.pending.time_review || 0) > 0 && <div data-board-no-export><TimeReviewList /></div>}
        </>
      )}
      {tab === 'dims' && (
        <ChartCard title="参赛者 × 维度" exportModels={modelLabels} sub="7 个质量维度得分" className="mt">
          <Heatmap rows={agg.board.map((b) => ({ id: b.entrant, label: nm.entrant(b.entrant) }))} cols={dims.map((d) => ({ id: d.id, label: d.name, color: `var(--d-${d.id})` }))} value={(r, c) => byEntrant.get(r)?.dims[c] ?? null} rowW={220} cell={76} />
        </ChartCard>
      )}
      {tab === 'tasks' && (
        <ChartCard title="参赛者 × 题目" exportModels={modelLabels} sub="每题均值；点击格子查看该模型的运行" className="mt">
          <Heatmap rows={agg.board.map((b) => ({ id: b.entrant, label: nm.entrant(b.entrant) }))} cols={agg.tkeys.map((k) => ({ id: k, label: k }))} rowW={220} cell={64}
            value={(r, c) => agg.tasks.find((t) => t.entrant === r && t.task === c)?.mean ?? null}
            text={(r, c, v) => { const t = agg.tasks.find((x) => x.entrant === r && x.task === c); return v == null ? '·' : `${v.toFixed(0)}${t && t.sd > 0 ? '±' + t.sd.toFixed(0) : ''}`; }}
            onCell={(r, c) => { localStorage.setItem('wb.runs.model', JSON.stringify(`${byEntrant.get(r)?.vendor || ''}/${byEntrant.get(r)?.model || ''}`)); localStorage.setItem('wb.runs.task', JSON.stringify(c.slice(0, 3))); go('runs'); }} />
        </ChartCard>
      )}
      {tab === 'eff' && (
        <div className="grid g-2 mt">
          <ChartCard title="成本 × 质量（帕累托）" exportModels={costRows.map(exportRow)} sub="越靠左上越好">
            <Pareto points={frontier(costRows.map((b) => ({ key: b.entrant, label: nm.entrant(b.entrant), x: b.suite_exp_cost_usd!, y: b.quality!, color: color(b.entrant) })))} />
          </ChartCard>
          <ChartCard title="用时 × 质量" exportModels={timeRows.map(exportRow)} sub="标准整套预计用时（按相对速度折算，分钟，对数）">
            <Pareto xLabel="标准整套预计用时（分钟，对数）" points={frontier(timeRows.map((b) => ({ key: b.entrant, label: nm.entrant(b.entrant), x: agg.eff![b.entrant].time.suite_est!, y: b.quality!, color: color(b.entrant) })))} />
          </ChartCard>
          <div className="span-all"><EffTable rows={agg.board} onExport={exportEfficiency} /><div data-board-no-export><TimeReviewList /></div></div>
          <Card title="期望值明细" sub="期望 = 单次平均 ÷ 达标率（达标率为 0 时为无穷）" className="span-all" pad={false}>
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>参赛者</th><th className="num">质量</th><th className="num">达标率</th><th className="num">整套期望成本</th><th className="num">整套期望用时</th><th>成本覆盖</th></tr></thead>
              <tbody>{agg.board.map((b) => <tr key={b.entrant}><td data-export-model={JSON.stringify(exportByEntrant(b.entrant))}>{nm.entrant(b.entrant)}</td><td className="num"><Score v={b.quality} /></td><td className="num">{fmt.pct(b.pass_rate)}</td><td className="num">{fmt.usd(b.suite_exp_cost_usd)}</td><td className="num">{fmt.min(b.suite_exp_min)}</td><td className="small muted">{b.cost_coverage}</td></tr>)}</tbody>
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
              <tbody>{agg.uplift.map((u) => <tr key={u.entrant}><td data-export-model={JSON.stringify(exportByEntrant(u.entrant))}>{nm.entrant(u.entrant)}</td><td className="num">{fmt.n(u.A_mean)}</td><td className="num">{fmt.n(u.C_mean)}</td><td className={cls('num b', u.uplift > 0 ? 'tone-text-ok' : 'tone-text-bad')}>{u.uplift > 0 ? '+' : ''}{fmt.n(u.uplift)}</td><td className="num">{fmt.n(u.anim_uplift)}</td><td className="num">{fmt.usd(u.A_cost)} / {fmt.usd(u.C_cost)}</td><td className="num">{fmt.min(u.A_min)} / {fmt.min(u.C_min)}</td></tr>)}</tbody>
            </table></div>
          )}
        </Card>
      )}
      {tab === 'fail' && (
        <Card title="失败归因" sub="门槛失败与未达标运行" className="mt" pad={false}>
          {!agg.failures.length ? <Empty title="没有失败运行" /> : (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>参赛者</th><th>题目</th><th>运行</th><th className="num">总分</th><th>归因</th></tr></thead>
              <tbody>{agg.failures.map((f) => <tr key={f.run_id} className="clickable" onClick={() => go('runs', [], { id: f.run_id })}><td data-export-model={JSON.stringify(exportByEntrant(f.entrant))}>{nm.entrant(f.entrant)}</td><td className="mono">{f.task}</td><td className="mono small">{nm.blind ? '—' : f.run_id}</td><td className="num"><Score v={f.total} /></td><td className="small">{nm.blind ? "—" : f.tags}</td></tr>)}</tbody>
            </table></div>
          )}
        </Card>
      )}
    </div>
  );
}

const nRange = (b: BoardRow) => (b.n_min === b.n_max ? String(b.n_max ?? '—') : `${b.n_min}–${b.n_max}`);

/** 完整版里没测满而未入榜的参赛者与缺口 */
function Excluded({ rows, label, modelLabel }: {
  rows?: { entrant: string; missing: string[] }[]; label: (e: string) => string; modelLabel: (e: string) => ReturnType<typeof modelImageLabel>;
}) {
  if (!rows?.length) return null;
  return (
    <Card title="未入榜（没测满）" sub="完整版要求每道 v2 题都测满 3 次；括号里是已测次数 / 要求次数" className="mt" pad={false}>
      <div className="tbl-wrap"><table className="tbl compact">
        <thead><tr><th>参赛者</th><th>缺口</th></tr></thead>
        <tbody>{rows.map((x) => <tr key={x.entrant}><td data-export-model={JSON.stringify(modelLabel(x.entrant))}>{label(x.entrant)}</td><td className="small">{x.missing.join('、')}</td></tr>)}</tbody>
      </table></div>
    </Card>
  );
}

function Head({ n, sel = [], onCompare, onExport, onlyN1, setOnlyN1 }: { n: number; sel?: string[]; onCompare?: () => void; onExport?: () => void; onlyN1?: boolean; setOnlyN1?: (v: boolean) => void }) {
  const wb = useWb();
  const v = wb.view;
  const ver = v === 'history' ? wb.spec?.cfg.version : wb.spec?.config_full.v2?.version;
  const hint = BOARD_VIEWS.find((x) => x.id === v)?.hint;
  return (
    <div className="page-head">
      <div className="page-head-t">
        <div className="eyebrow">{wb.spec?.cfg.name} {ver} · {n} 个参赛者（模型 @ harness）</div>
        <h1 className="page-title">排行榜</h1>
        <div className="row gap-s" style={{ flexWrap: 'wrap', margin: '6px 0' }}>
          <Seg value={v} onChange={wb.setView} options={BOARD_VIEWS.map((x) => ({ value: x.id, label: x.label }))} />
          <span className="muted small">{hint}</span>
          {v === 'simple' && setOnlyN1 && <label className="row gap-s small"><CheckBox checked={!!onlyN1} onChange={() => setOnlyN1(!onlyN1)} label="只看 n=1（没有重测）" />只看 n=1（没有重测）</label>}
        </div>
        <p className="page-sub">质量总分 = 质量维度按权重合成；成本与速度单独列出，{v === 'full' ? '稳定性是独立雷达轴，' : ''}不混入质量分。评分规则见 <a href="#/docs/scoring">方法论</a>。</p>
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
