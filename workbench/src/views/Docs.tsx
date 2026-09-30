// 方法论：面向读榜访客的独立文档页（原 benchmark-spec.html 的全部内容，原生重构）。左侧目录 + 滚动定位，含图表。
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Boxes, Braces, CheckCircle2, Clock3, Gauge, GitBranch, Layers, ListChecks, Repeat, Scale, ShieldCheck, Sparkles, Target, Timer, Wrench } from 'lucide-react';
import { useWb } from '../state';
import { go, href, useRoute } from '../lib/router';
import { cls } from '../lib/format';
import { Card, CopyBtn } from '../ui/kit';
import { ChartCard, Donut, Heatmap, Radar } from '../ui/charts';
import { DimChip } from '../components/common';

const SECTIONS = [
  { id: 'overview', label: '概览', icon: BookOpen },
  { id: 'principles', label: '设计原则', icon: Target },
  { id: 'dimensions', label: '雷达维度', icon: Gauge },
  { id: 'matrix', label: '题目 × 维度', icon: Layers },
  { id: 'relations', label: '题目关系', icon: GitBranch },
  { id: 'library', label: '题库', icon: ListChecks },
  { id: 'scoring', label: '评分体系', icon: Scale },
  { id: 'protocol', label: '运行协议', icon: Repeat },
  { id: 'exports', label: '导出表格', icon: Braces },
  { id: 'tools', label: '评分工具', icon: Wrench },
];

export default function Docs() {
  const wb = useWb();
  const route = useRoute();
  const spec = wb.spec;
  const [active, setActive] = useState(route.parts[0] || 'overview');
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const id = route.parts[0];
    if (id) document.getElementById('doc-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [route.parts[0]]); // eslint-disable-line
  useEffect(() => {
    const scroller = document.getElementById('view');
    if (!scroller) return;
    const on = () => {
      const tops = SECTIONS.map((s) => ({ id: s.id, top: document.getElementById('doc-' + s.id)?.getBoundingClientRect().top ?? 9999 }));
      const cur = tops.filter((t) => t.top < 180).pop();
      if (cur) setActive(cur.id);
    };
    scroller.addEventListener('scroll', on, { passive: true });
    return () => scroller.removeEventListener('scroll', on);
  }, []);
  const stats = useMemo(() => {
    if (!spec) return null;
    const items = spec.tasks.flatMap((t) => t.items);
    const cnt = (k: 'method' | 'tier') => { const m = new Map<string, number>(); for (const i of items) m.set(i[k], (m.get(i[k]) || 0) + 1); return m; };
    return { items: items.length, method: cnt('method'), tier: cnt('tier') };
  }, [spec]);
  if (!spec || !stats) return <div className="page"><div className="skel" style={{ height: 480 }} /></div>;
  const cfg = spec.cfg;
  const qd = spec.dims.filter((d) => d.kind === 'quality');
  const coverage = Object.fromEntries(spec.dims.map((d) => [d.id, spec.tasks.reduce((s, t) => s + (t.dims[d.id] || 0), 0)]));
  const maxCov = Math.max(1, ...Object.values(coverage));
  const MC: Record<string, string> = { auto: 'var(--info)', agent: 'var(--accent)', human: 'var(--d-anim)' };
  const TC: Record<string, string> = { basic: 'var(--text-4)', advanced: 'var(--info)', excellent: 'var(--accent)', clean: 'var(--warn)' };
  const ML: Record<string, string> = { auto: '自动', agent: 'Agent 审查', human: '人工' };
  const TL: Record<string, string> = { basic: '基础', advanced: '进阶', excellent: '卓越', clean: '扣分项' };

  return (
    <div className="page docs" ref={root}>
      <aside className="docs-toc glass-thin">
        <div className="docs-toc-h">方法论</div>
        {SECTIONS.map((s) => <a key={s.id} href={href('docs', [s.id])} className={cls('toc-i', active === s.id && 'on')} onClick={(e) => { e.preventDefault(); go('docs', [s.id], undefined, true); document.getElementById('doc-' + s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}><s.icon size={15} />{s.label}</a>)}
        <div className="hair" style={{ margin: '10px 6px' }} />
        <a className="toc-i" href={href('board')}><ArrowRight size={15} />查看排行榜</a>
      </aside>
      <article className="docs-body">
        {/* 概览 */}
        <section id="doc-overview" className="doc-sec">
          <div className="doc-hero glass">
            <div className="eyebrow"><Sparkles size={13} />Benchmark 规范 · 编码与创作能力 · {cfg.name} {cfg.version}{cfg.frozen_date ? ` · 冻结于 ${cfg.frozen_date}` : ''}</div>
            <h1 className="doc-title">一套面向「模型 + harness」的小型基准</h1>
            <p className="doc-lead">{spec.tasks.length} 道题覆盖 3D、动画、前端、后端、工程化、需求理解与 Agent 执行，每题配细粒度检查项。能自动验收的全部自动化，必须靠人看的集中盲评，最后输出雷达图、排行榜与效率对比。</p>
            <div className="doc-kpis">
              <div><b>{spec.tasks.length}</b><span>道题</span></div>
              <div><b>{spec.dims.length}</b><span>个维度（{qd.length} 质量 + {spec.dims.length - qd.length} 效率）</span></div>
              <div><b>{stats.items}</b><span>个检查项</span></div>
              <div><b>{cfg.runs_per_task}×</b><span>每题每参赛者运行次数</span></div>
              <div><b>≥{cfg.pass_threshold}</b><span>单次达标线</span></div>
            </div>
          </div>
        </section>

        {/* 设计原则 */}
        <section id="doc-principles" className="doc-sec">
          <div className="doc-h"><span className="eyebrow">为什么这样设计</span><h2>设计原则与闭环</h2><p>benchmark 的本质是用少量样本估计模型在你关心的任务分布上的表现。要估得准，需要同时满足四个条件，并让下面这条链能转起来。</p></div>
          <div className="grid g-4">
            {[
              { i: Target, t: '效度', s: '测你真正关心的', d: '第一版聚焦编码：前后端、3D、动画、工程化。写作与知识时效暂不纳入。每道题都标明它支撑哪些维度。' },
              { i: Repeat, t: '信度', s: '重测结果稳定', d: `固定环境与依赖版本、每题每参赛者至少 ${cfg.runs_per_task} 次、自动项占多数、人工项用 4 级锚点并盲评。` },
              { i: Layers, t: '区分度', s: '避免人人满分', d: '检查项分基础、进阶、卓越三层；尽量用连续指标；隐藏测试含边界、安全与并发；埋入未报告缺陷和需求矛盾。' },
              { i: ShieldCheck, t: '可持续', s: '能长期用下去', d: '全部使用虚构品牌与原创素材；隐藏测试不公开；题库带版本号；跑完用「题目分析」表替换失去区分度的检查项。' },
            ].map((p) => (
              <div key={p.t} className="principle glass"><span className="pr-ic"><p.i size={18} /></span><h3>{p.t}</h3><div className="muted small">{p.s}</div><p className="small dim mt-s">{p.d}</p></div>
            ))}
          </div>
          <div className="loop glass-thin mt-l">
            {['定义能力（9 维）', `出题（${spec.tasks.length} 题）`, `执行（固定环境 ×${cfg.runs_per_task}）`, '评分（自动 + Agent + 人工）', '分析（雷达、效率、题目分析）', '修题，回到第一步'].map((s, i, a) => (
              <span key={s} className="loop-i"><span className="loop-n">{i + 1}</span>{s}{i < a.length - 1 && <ArrowRight size={14} className="muted" />}</span>
            ))}
          </div>
        </section>

        {/* 雷达维度 */}
        <section id="doc-dimensions" className="doc-sec">
          <div className="doc-h"><span className="eyebrow">雷达图的 {spec.dims.length} 条轴</span><h2>雷达维度</h2><p>{qd.length} 个质量维度按权重合成质量总分；成本效率与速度单独换算，不直接混入质量分。每个维度至少由两道题支撑。</p></div>
          <div className="grid g-2">
            <ChartCard title="维度覆盖" sub="各题对该维度的贡献权重之和（主要 1.0、次要 0.5）">
              <div className="center"><Radar max={maxCov} rings={4} axes={spec.dims.map((d) => ({ id: d.id, label: d.name }))} series={[{ key: 'cov', label: '覆盖', color: 'var(--accent)', values: coverage }]} /></div>
            </ChartCard>
            <div className="dim-list">
              {spec.dims.map((d) => (
                <div key={d.id} className="dim-i glass-thin">
                  <span className="dim-sw" style={{ background: `var(--d-${d.id})` }} />
                  <div className="grow"><div className="row gap-s"><b>{d.name}</b><span className={cls('badge', d.kind === 'quality' ? 'tone-accent' : 'tone-info')}>{d.kind === 'quality' ? `质量 · 权重 ${d.weight ?? 1}` : '效率'}</span></div><p className="small dim">{d.desc}</p></div>
                  <span className="mono muted small">{spec.tasks.filter((t) => t.dims[d.id]).length} 题</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 矩阵 */}
        <section id="doc-matrix" className="doc-sec">
          <div className="doc-h"><span className="eyebrow">覆盖关系</span><h2>题目 × 维度矩阵</h2><p>格子里是该题对该维度的贡献权重（主要考察 1.0，次要 0.5）与对应检查项数量。维度分 = 各题该维度得分按权重加权平均。</p></div>
          <ChartCard title="题目 × 维度" sub="权重 / 检查项数">
            <Heatmap rows={spec.tasks.map((t) => ({ id: t.id, label: `${t.id} ${t.name}` }))} cols={spec.dims.map((d) => ({ id: d.id, label: d.name, color: `var(--d-${d.id})` }))} rowW={250} cell={70} legend={false}
              value={(r, c) => { const w = spec.tasks.find((t) => t.id === r)?.dims[c]; return w ? w * 100 : null; }}
              text={(r, c, v) => { if (v == null) return ''; const n = spec.tasks.find((t) => t.id === r)!.items.filter((i) => i.dim === c).length; return `${(v / 100).toFixed(1)}${n ? ' · ' + n : ''}`; }}
              onCell={(r) => go('tasks', [r])} />
          </ChartCard>
        </section>

        {/* 关系 */}
        <section id="doc-relations" className="doc-sec">
          <div className="doc-h"><span className="eyebrow">题目之间</span><h2>题目关系</h2><p>题目不是孤立的：同一业务域、对照实验与共享品牌让横向比较更有意义。</p></div>
          <div className="grid g-2">
            {spec.relations.map((r) => (
              <div key={r.title} className="rel glass"><h3>{r.title}</h3><div className="chips mt-s">{r.tasks.map((t) => <a key={t} className="chip mono" href={href('tasks', [t])}>{t}</a>)}</div><p className="small dim mt-s">{r.text}</p></div>
            ))}
          </div>
        </section>

        {/* 题库 */}
        <section id="doc-library" className="doc-sec">
          <div className="doc-h"><span className="eyebrow">题库 {cfg.version}</span><h2>题库</h2><p>每道题包含：发给模型的原文提示词、门槛条件、全部检查项（维度、层级、方式、权重、换算规则）与人工 / Agent 项的 0–3 锚点。点击卡片查看完整细则。</p></div>
          <div className="grid g-3">
            <Card title="检查项方式"><div className="compo"><Donut size={120} thick={14} center={stats.items} sub="检查项" parts={[...stats.method].map(([k, n]) => ({ label: ML[k] || k, value: n, color: MC[k] }))} /><div className="legend-list">{[...stats.method].map(([k, n]) => <span key={k}><i style={{ background: MC[k] }} />{ML[k]}<b>{n}</b></span>)}</div></div></Card>
            <Card title="检查项层级"><div className="compo"><Donut size={120} thick={14} center={stats.items} sub="检查项" parts={[...stats.tier].map(([k, n]) => ({ label: TL[k] || k, value: n, color: TC[k] }))} /><div className="legend-list">{[...stats.tier].map(([k, n]) => <span key={k}><i style={{ background: TC[k] }} />{TL[k]}<b>{n}</b></span>)}</div></div></Card>
            <Card title="运行条件"><ul className="plain-list small">{spec.tasks.map((t) => <li key={t.id}><b className="mono">{t.id}</b> <span className="dim">{t.time_limit} 分钟 · {/有人值守/.test(t.condition) ? '有人值守' : '无人值守'}</span></li>)}</ul></Card>
          </div>
          <div className="grid g-auto mt-l">
            {spec.tasks.map((t) => (
              <a key={t.id} className="lib-card glass sheen" href={href('tasks', [t.id], { tab: 'rubric' })}>
                <span className="sheen-l" aria-hidden />
                <div className="row gap-s"><span className="task-badge sm">{t.id}</span><b className="grow ellipsis">{t.name}</b></div>
                <p className="small dim">{t.short}</p>
                <div className="chips">{Object.entries(t.dims).map(([k, w]) => <DimChip key={k} id={k} w={w} />)}</div>
                <div className="row gap-s muted xs"><Clock3 size={12} />{t.time_limit} 分钟<ListChecks size={12} />{t.items.length} 项<Boxes size={12} />{t.deliverable}/</div>
              </a>
            ))}
          </div>
        </section>

        {/* 评分体系 */}
        <section id="doc-scoring" className="doc-sec">
          <div className="doc-h"><span className="eyebrow">分数怎么来</span><h2>评分体系</h2></div>
          <div className="layers">
            {[
              { n: '0', t: '门槛', d: '能运行、交付物存在、最终汇报与实际一致。任一不过，该次运行记 0 分并进入失败归因。', i: ShieldCheck },
              { n: '1', t: '自动检查', d: '探针直接测量（隐藏测试、浏览器检查、逐帧采样、ffprobe、构建与类型检查），按规则换算为 0–1。', i: Gauge },
              { n: '2', t: 'Agent 审查', d: '执行评分 skill 的 Agent 阅读代码与文档，按锚点打 0–3 分并附证据，用户可改。', i: Sparkles },
              { n: '3', t: '人工评分', d: '只保留必须靠人看的项（观感、创意、手感），集中一次询问、盲评、同一检查项横向比较。', i: CheckCircle2 },
            ].map((l) => <div key={l.n} className="layer glass-thin"><span className="layer-n">{l.n}</span><l.i size={18} /><div><b>{l.t}</b><p className="small dim">{l.d}</p></div></div>)}
          </div>
          <div className="grid g-2 mt-l">
            <Card title="防「人人满分」的设计">
              <ul className="plain-list small dim">
                <li>层级权重：基础 1、进阶 2、卓越 3（可在检查项上单独指定）。</li>
                <li>连续指标：帧率、误差、比例、测试通过率都线性换算，不做一刀切。</li>
                <li>卓越项专门拉开差距：定格节奏、节拍对齐、级分离精度、未报告缺陷、矛盾识别。</li>
                <li>扣分项（clean）：报错、占位代码、PIN 明文等，满分表示「干净」。</li>
                <li>报告单列分层得分：基础项都满分时，差距体现在进阶与卓越层。</li>
              </ul>
            </Card>
            <Card title="换算规则" pad={false}>
              <table className="tbl compact"><thead><tr><th>规则</th><th>含义</th></tr></thead><tbody>
                {[['bool', '为真（或指定期望值）得 1'], ['ratio', '比例直接作为得分'], ['min / max', '达到阈值得 1；给出 zero 时在阈值与 zero 之间线性'], ['linear', '从 bad 到 good 线性映射，可选对数刻度'], ['band', '落在区间内得 1，偏离 tol 记 0'], ['eq', '等于目标值得 1'], ['锚点 0–3', '人工与 Agent 项，除以 3']].map(([a, b]) => <tr key={a}><td className="mono">{a}</td><td className="small">{b}</td></tr>)}
              </tbody></table>
            </Card>
            <Card title="状态处理">
              <div className="stack s small">
                <div><span className="badge tone-bad">缺失</span> <span className="dim">被测产出没有提供该指标（接口没实现、文件不存在），记 0 分。</span></div>
                <div><span className="badge">N/A</span> <span className="dim">评测环境原因无法检查（没装 ffmpeg、无法访问 npm），不计入分母；占比超过 {Math.round(cfg.low_confidence_na_ratio * 100)}% 标记「低可信」。</span></div>
                <div><span className="badge tone-warn">待评</span> <span className="dim">人工或 Agent 项还没打分，不计入分母，报告标注「评分不完整」。</span></div>
              </div>
            </Card>
            <Card title="从检查项到排行榜">
              <div className="flow small">
                {['检查项 0–1', '× 层级权重 → 题目内维度分', '题目总分（门槛不过记 0）', `每题 ${cfg.runs_per_task} 次取均值`, '维度分 = 各题按贡献权重加权', '质量总分 = 维度按权重合成'].map((s, i, a) => <span key={s} className="flow-i">{s}{i < a.length - 1 && <ArrowRight size={12} />}</span>)}
              </div>
            </Card>
            <Card title="效率维度">
              <div className="stack s small dim">
                <div><Timer size={13} style={{ display: 'inline', verticalAlign: -2 }} /> <b>期望成功成本</b> = 单次费用 ÷ 达标率；≤ ${cfg.efficiency.cost.best} 记 100 分，≥ ${cfg.efficiency.cost.worst} 记 0 分，对数刻度线性插值。</div>
                <div><Clock3 size={13} style={{ display: 'inline', verticalAlign: -2 }} /> <b>期望达标用时</b>：≤ {cfg.efficiency.speed.best} 分钟记 100，≥ {cfg.efficiency.speed.worst} 分钟记 0。</div>
                <div>默认只报告质量总分 + 两个效率维度，不强行合并成综合分。</div>
              </div>
            </Card>
            <Card title="统计与并列">
              <p className="small dim">对每个参赛者，在各题内部重抽运行（bootstrap，默认 {spec.config_full.statistics?.bootstrap_samples ?? 2000} 次）得到质量总分的 {Math.round((spec.config_full.statistics?.ci ?? 0.95) * 100)}% 置信区间。与上一名次首位的区间重叠的记为并列（名次后加「=」）。同时报告每题标准差、最低 / 最高分与 pass@k。</p>
            </Card>
          </div>
        </section>

        {/* 运行协议 */}
        <section id="doc-protocol" className="doc-sec">
          <div className="doc-h"><span className="eyebrow">怎么跑</span><h2>运行协议</h2></div>
          <div className="grid g-2">
            <Card title="环境与次数"><ul className="plain-list small dim">
              <li>每个「模型 @ harness」每题跑 {cfg.runs_per_task} 次，全部从干净工作目录开始（工作台自动创建 <code>model/&lt;供应商&gt;/&lt;模型&gt;/&lt;题号&gt;/rN/</code>）。</li>
              <li>固定工具集、依赖版本、Chromium 版本与时间上限（见各题卡片）。</li>
              <li>无人值守题目不回答模型提问；T06 为有人值守，评测者只按意图表作答。</li>
              <li>T03 A 组环境中不得存在任何动画 / 视频 skill；C 组预装同一版本 HyperFrames skills。</li>
              <li>提示词带统一「运行约定」：工作目录绝对路径、交付文件夹名、必须存在的文件、<code>FINAL_MESSAGE.md</code> 结束约定。</li>
            </ul></Card>
            <Card title="人工评分怎么收集"><ul className="plain-list small dim">
              <li>自动评分跑完后，在工作台预览产物时同屏打分（键盘 0–3），或一次性生成评分包。</li>
              <li>盲评模式把模型名替换为代号，同一检查项的所有运行横向比较。</li>
              <li>动画题使用统一管线逐帧渲染的评审视频，避免各家渲染环境差异。</li>
              <li>Agent 项先由评分 Agent 填写并附证据，用户确认或修改。</li>
            </ul></Card>
            <Card title="用时与成本从哪来"><ul className="plain-list small dim">
              <li>用户在登记运行时直接提供（最优先）；工作台以复制提示词到 <code>FINAL_MESSAGE.md</code> 出现为计时窗口。</li>
              <li>否则解析 harness 本地日志：Claude Code、Codex CLI、Gemini CLI，按工作目录与时间窗口匹配会话。</li>
              <li>token × <code>config/prices.yaml</code> 单价得到估算费用（订阅制也按 API 等价价格估算并标注）。</li>
              <li>仍然缺失的汇总到 <code>usage_needed.csv</code>，一次性请用户补填。</li>
            </ul></Card>
            <Card title="开跑前要准备的素材"><ul className="plain-list small dim">
              {spec.tasks.filter((t) => t.materials.length).map((t) => <li key={t.id}><b className="mono">{t.id}</b> {t.materials.join('；')}</li>)}
            </ul></Card>
          </div>
        </section>

        {/* 导出 */}
        <section id="doc-exports" className="doc-sec">
          <div className="doc-h"><span className="eyebrow">产出</span><h2>导出表格</h2><p>所有表格同时导出 CSV（UTF-8 BOM）、汇总到 benchmark.xlsx，排行榜另有 Markdown 版与单页 HTML 报告；工作台内任意图表可导出 PNG / SVG 并批量打包。</p></div>
          <Card pad={false}><div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>文件</th><th>内容</th><th>用途</th></tr></thead>
            <tbody>{[
              ['leaderboard', '名次、质量总分与置信区间、9 维得分、达标率、整套期望成本与用时', '对外发布的主表'],
              ['radar.png / radar_NN.png', '全部参赛者叠加雷达图 + 每个参赛者单独一张', '一图看强弱项'],
              ['task_matrix / tasks', '参赛者 × 题目的均值 ± 标准差、最低最高、pass@k、门槛失败次数', '看稳定性与单题表现'],
              ['task_dims', '参赛者 × 题目 × 维度', '追溯维度分来源'],
              ['tiers', '基础 / 进阶 / 卓越 / 扣分项分层得分率', '基础项都满分时看差距在哪一层'],
              ['efficiency / pareto.png', '单次费用与用时、达标率、期望成功成本、帕累托前沿', '选「性价比」模型'],
              ['skill_uplift', 'T03 A/C 两组得分、动画分、费用与用时之差', '衡量 skill 带来的增益'],
              ['failures', '门槛失败与未达标运行的失败归因', '区分模型问题与 harness / 环境问题'],
              ['item_analysis', '每个检查项的平均分、参赛者间与参赛者内标准差、天花板 / 地板 / 区分度低标记', '迭代题库'],
              ['coverage', '题目 × 维度权重与检查项数', '检查覆盖是否均衡'],
              ['runs / item_scores_long', '每次运行的得分、token、费用、来源；每个检查项的原始值与得分', '审计与二次分析'],
              ['report.html', '单页汇总报告（内嵌图表）', '直接分享'],
            ].map(([a, b, c]) => <tr key={a}><td className="mono small">{a}</td><td className="small">{b}</td><td className="small dim">{c}</td></tr>)}</tbody>
          </table></div></Card>
        </section>

        {/* 工具 */}
        <section id="doc-tools" className="doc-sec">
          <div className="doc-h"><span className="eyebrow">bench-grader + bench-workbench</span><h2>评分工具</h2><p>评分规则、探针与导出封装在 bench-grader skill 中；工作台通过 <code>wb</code> CLI 暴露给任何 Agent。两个 skill 同时镜像在 <code>.agents/skills/</code>。</p></div>
          <div className="grid g-2">
            <CmdCard title="工作台 CLI（wb）" text={`wb status                          # 服务、模型、运行与待办
wb model add OpenAI/GPT-6.1-Sol     # 新建模型与目录（也可只写名称，自动识别供应商）
wb prompt T05 --for OpenAI/GPT-6.1-Sol   # 带运行约定的最终提示词
wb run new OpenAI/GPT-6.1-Sol T05   # 干净工作目录 + 预置素材
wb run finish <ref> --register      # 登记并自动评分
wb pending --method agent --json    # 待评 Agent 项
wb score <run_id> <item> <0-3> --note "证据" --by agent
wb check <ref> --json               # 无头 Chromium：报错 + 截图
wb board / wb compare GPT Claude    # 出榜与对比
wb export                           # 全量导出`} />
            <CmdCard title="bench-grader（Python）" text={`python scripts/bench.py doctor
python scripts/bench.py init-run --task T07 --model "模型名" --harness "Claude Code" \\
    --src ./workdir/studyspot-api --final-message final.md --workspace ./workdir
python scripts/bench.py grade --all
python scripts/bench.py review
python scripts/bench.py ingest-scores human_scores.csv
python scripts/bench.py aggregate
python scripts/bench.py export --formats csv,md,xlsx,png,html`} />
          </div>
        </section>
      </article>
    </div>
  );
}

function CmdCard({ title, text }: { title: string; text: string }) {
  return <Card title={title} extra={<CopyBtn text={text} size="sm" tone="ghost" />}><pre className="prompt">{text}</pre></Card>;
}
