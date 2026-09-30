// 导出中心：图表画廊（一键打包 PNG+SVG）、批量单模型报告、bench-grader 全量导出、可移植存储文件导入导出、历史导出。
import { useEffect, useRef, useState } from 'react';
import { Database, FileArchive, FileStack, FileText, FolderOpen, Images, Upload } from 'lucide-react';
import { get, post, rawUrl } from '../api';
import { useWb } from '../state';
import { cls, fmt, splitEntrant } from '../lib/format';
import { exportAllCharts } from '../lib/exporter';
import { Badge, Btn, Card, Empty, Field } from '../ui/kit';
import { ChartCard, Heatmap, Pareto, Radar, seriesColor } from '../ui/charts';
import { toast } from '../ui/toast';
import { useNamer } from '../components/common';
import { frontier } from './Board';

const FORMATS = ['csv', 'md', 'xlsx', 'png', 'html'] as const;

export default function Exports() {
  const wb = useWb();
  const nm = useNamer();
  const gallery = useRef<HTMLDivElement>(null);
  const [fmts, setFmts] = useState<string[]>([...FORMATS]);
  const [label, setLabel] = useState('leaderboard');
  const [reports, setReports] = useState<{ name: string; files: string[]; mtime: number }[]>([]);
  const [busy, setBusy] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const load = () => void get<typeof reports>('/api/reports').then(setReports, () => setReports([]));
  useEffect(load, [wb.jobs.length]);
  const agg = wb.agg;
  const dims = (wb.spec?.dims || []).filter((d) => d.kind === 'quality');
  const ents = agg?.board || [];

  const zip = async () => {
    setBusy('zip');
    try { const n = await exportAllCharts(gallery.current!, `bench-charts-${new Date().toISOString().slice(0, 10)}.zip`); toast.ok(n ? `已打包 ${n} 张图表（PNG 2× + SVG）` : '没有可导出的图表'); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(''); }
  };
  const reportsAll = async () => {
    setBusy('reports');
    let ok = 0;
    for (const m of wb.store?.models || []) { try { await post('/api/models/report', { vendor: m.vendor, name: m.name }); ok++; } catch { /* 继续 */ } }
    setBusy('');
    toast.ok(`已生成 ${ok} 份单模型报告 → model/<供应商>/<模型>/_report/REPORT.md`);
  };
  const importStore = async (f: File) => {
    try {
      const data = JSON.parse(await f.text());
      const r = await post<{ runs: number; models: number; workspaces: number; notes: number }>('/api/store/import', data);
      toast.ok(`已合并：${r.runs} 次运行、${r.models} 个模型、${r.workspaces} 个工作区、${r.notes} 条笔记`);
      await wb.refresh(['store', 'agg']);
    } catch (e: any) { toast.error('导入失败：' + e.message); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-head-t">
          <h1 className="page-title">导出</h1>
          <p className="page-sub">所有图表都可以单张导出（图表右上角 ⋯），这里负责批量：图表打包、单模型报告、bench-grader 全量报表，以及可复制到其他电脑的存储文件。</p>
        </div>
      </div>

      <div className="grid g-2">
        <Card title={<span className="row gap-s"><Images size={16} />图表打包</span>} sub="下方画廊中的全部图表">
          <p className="dim small">每张图同时导出 2× PNG 与矢量 SVG，带标题与主题背景，打包成一个 ZIP。</p>
          <div className="row gap-s mt"><Btn tone="primary" icon={<FileArchive size={15} />} busy={busy === 'zip'} onClick={() => void zip()} disabled={!ents.length}>打包 {ents.length ? 4 + ents.length : 0} 张图表</Btn><span className="muted small">当前主题：{document.documentElement.dataset.theme === 'dark' ? '深色' : '浅色'}（切换主题可导出另一套配色）</span></div>
        </Card>
        <Card title={<span className="row gap-s"><FileText size={16} />单模型报告</span>} sub="批量更新">
          <p className="dim small">为每个模型写入 <code>model/&lt;供应商&gt;/&lt;模型&gt;/_report/REPORT.md</code> 与 <code>summary.json</code>。</p>
          <div className="row gap-s mt"><Btn icon={<FileStack size={15} />} busy={busy === 'reports'} onClick={() => void reportsAll()} disabled={!wb.store?.models.length}>生成全部 {wb.store?.models.length || 0} 份报告</Btn></div>
        </Card>
        <Card title={<span className="row gap-s"><FileArchive size={16} />bench-grader 全量导出</span>} sub="reports/<时间>-<标签>/">
          <p className="dim small">排行榜、雷达、题目矩阵、分层得分、效率与帕累托、skill 增益、失败归因、题目分析、覆盖矩阵、运行与检查项明细、benchmark.xlsx、report.html，附存储文件快照。</p>
          <div className="chips mt">{FORMATS.map((f) => <button key={f} className={cls('chip', fmts.includes(f) && 'on')} onClick={() => setFmts(fmts.includes(f) ? fmts.filter((x) => x !== f) : [...fmts, f])}>{f.toUpperCase()}</button>)}</div>
          <div className="row gap-s mt">
            <Field label="标签" className="grow"><input value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
            <Btn tone="primary" style={{ alignSelf: 'flex-end' }} disabled={!fmts.length} onClick={() => void wb.runJob({ kind: 'export', formats: fmts.join(','), label }, '全量导出')}>开始导出</Btn>
          </div>
        </Card>
        <Card title={<span className="row gap-s"><Database size={16} />可移植存储文件</span>} sub={wb.session.paths.store.split(/[\\/]/).slice(-2).join('/')}>
          <p className="dim small">一个 JSON 文件包含模型档案、全部运行的分数与逐项结果、人工评分、用量与笔记。复制到另一台电脑后导入（按运行 id 合并，较新的覆盖）即可恢复全部对比。</p>
          <div className="row gap-s mt">
            <Btn icon={<Database size={15} />} onClick={() => { location.href = '/api/store/export'; }}>下载存储文件</Btn>
            <Btn icon={<Upload size={15} />} onClick={() => file.current?.click()}>导入并合并</Btn>
            <Btn tone="ghost" onClick={() => void wb.runJob({ kind: 'sync' }, '同步')}>重新同步</Btn>
            <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importStore(f); e.target.value = ''; }} />
          </div>
        </Card>
      </div>

      <div className="section">
        <div className="section-h"><h2>图表画廊</h2><p>打包导出的就是这些图</p></div>
        {!ents.length ? <Card><Empty title="还没有评分数据">评分完成后这里会出现可导出的图表。</Empty></Card> : (
          <div className="grid g-2" ref={gallery}>
            <ChartCard title="维度雷达 · 全部参赛者">
              <div className="center"><Radar axes={dims.map((d) => ({ id: d.id, label: d.name }))} series={ents.slice(0, 8).map((b, i) => ({ key: b.entrant, label: nm.entrant(b.entrant), color: seriesColor(i), values: b.dims }))} /></div>
            </ChartCard>
            <ChartCard title="成本 × 质量（帕累托）">
              <Pareto points={frontier(ents.filter((b) => b.quality != null && b.suite_exp_cost_usd != null).map((b, i) => ({ key: b.entrant, label: nm.entrant(b.entrant), x: b.suite_exp_cost_usd!, y: b.quality!, color: seriesColor(i) })))} />
            </ChartCard>
            <ChartCard title="参赛者 × 维度" className="span-all">
              <Heatmap rows={ents.map((b) => ({ id: b.entrant, label: nm.entrant(b.entrant) }))} cols={dims.map((d) => ({ id: d.id, label: d.name, color: `var(--d-${d.id})` }))} value={(r, c) => ents.find((b) => b.entrant === r)?.dims[c] ?? null} rowW={220} cell={76} />
            </ChartCard>
            <ChartCard title="参赛者 × 题目" className="span-all">
              <Heatmap rows={ents.map((b) => ({ id: b.entrant, label: nm.entrant(b.entrant) }))} cols={(agg?.tkeys || []).map((k) => ({ id: k, label: k }))} rowW={220} cell={64} value={(r, c) => agg?.tasks.find((t) => t.entrant === r && t.task === c)?.mean ?? null} />
            </ChartCard>
            {ents.map((b, i) => (
              <ChartCard key={b.entrant} title={`${nm.blind ? nm.entrant(b.entrant) : splitEntrant(b.entrant).model} 维度雷达`} sub={`${splitEntrant(b.entrant).harness} · 质量 ${fmt.n(b.quality)} · #${b.rank}`}>
                <div className="center"><Radar size={320} axes={dims.map((d) => ({ id: d.id, label: d.name }))} series={[{ key: b.entrant, label: nm.entrant(b.entrant), color: seriesColor(i), values: b.dims }]} /></div>
              </ChartCard>
            ))}
          </div>
        )}
      </div>

      <div className="section">
        <div className="section-h"><h2>历史导出</h2><p>reports/ 目录</p></div>
        <Card pad={false}>
          {!reports.length ? <Empty title="还没有导出" /> : (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>目录</th><th>时间</th><th>文件</th><th /></tr></thead>
              <tbody>{reports.map((r) => (
                <tr key={r.name}>
                  <td className="mono small">{r.name}</td><td className="small">{fmt.time(r.mtime)}</td>
                  <td><div className="chips">{r.files.slice(0, 8).map((f) => <a key={f} className="chip" href={rawUrl(`reports/${r.name}/${f}`, true)}>{f}</a>)}{r.files.length > 8 && <Badge>+{r.files.length - 8}</Badge>}</div></td>
                  <td><Btn size="xs" tone="ghost" icon={<FolderOpen size={13} />} onClick={() => void post('/api/open-folder', { path: `reports/${r.name}` }).catch((e) => toast.error(e.message))}>打开</Btn></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      </div>
    </div>
  );
}
