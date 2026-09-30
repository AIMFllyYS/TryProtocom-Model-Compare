// 题库规范：完整承接 benchmark-spec.html 的全部内容（概览、原则、维度、矩阵、关系、题库细则、评分体系、运行协议、导出、工具），并可直接从题目发起运行。
import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, RefreshCw, Search } from 'lucide-react';
import type { SpecItem, SpecTask } from '../../shared/types';
import { get } from '../api';
import { useWb } from '../state';
import { go, useRoute } from '../lib/router';
import { cls, METHOD_LABEL, TIER_LABEL } from '../lib/format';
import { Badge, Btn, CopyBtn, Seg, Spinner } from '../ui/kit';
import { DimChip, NewRunModal } from '../components/common';

const SECTIONS = [
  ['overview', '概览'], ['principles', '设计原则'], ['dims', '雷达维度'], ['matrix', '题目与维度'], ['tasks', '题库与评分细则'],
  ['scoring', '评分体系'], ['protocol', '运行协议'], ['exports', '导出表格'], ['tooling', '评分工具'],
] as const;

export default function Spec() {
  const wb = useWb();
  const route = useRoute();
  const S = wb.spec;
  const main = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState('overview');
  const target = route.parts[0];
  useEffect(() => {
    if (!target || !S) return;
    const el = document.getElementById(target.startsWith('T') ? `task-${target}` : target);
    if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }, [target, S]);
  useEffect(() => {
    const root = document.getElementById('view');
    if (!root) return;
    const on = () => {
      let cur = 'overview';
      for (const [id] of SECTIONS) { const el = document.getElementById(id); if (el && el.getBoundingClientRect().top < 140) cur = id; }
      setActive(cur);
    };
    root.addEventListener('scroll', on, { passive: true });
    return () => root.removeEventListener('scroll', on);
  }, [S]);
  if (!S) return <div className="page"><Spinner /></div>;
  const all = S.tasks.flatMap((t) => t.items);
  const qdims = S.dims.filter((d) => d.kind === 'quality');
  const auto = all.filter((i) => i.method === 'auto').length;
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const ef = S.cfg.efficiency;
  return (
    <div className="spec">
      <nav className="spec-toc" aria-label="目录">
        <div className="spec-brand">{S.cfg.name}</div>
        <div className="mono muted xs">{S.cfg.version}{S.cfg.frozen_date ? ' · ' + S.cfg.frozen_date : ''} · 来源 {S._source === 'python' ? 'rubric' : S._source === 'cache' ? '缓存' : 'HTML'}</div>
        {SECTIONS.map(([id, label]) => (
          <div key={id}>
            <button className={cls('toc-i', active === id && 'on')} onClick={() => jump(id)}>{label}</button>
            {id === 'tasks' && <div className="toc-sub">{S.tasks.map((t) => <button key={t.id} className="toc-i sub" onClick={() => jump('task-' + t.id)}><span className="mono">{t.id}</span> {t.name}</button>)}</div>}
          </div>
        ))}
        <Btn size="xs" tone="ghost" icon={<RefreshCw size={12} />} onClick={() => void get('/api/spec', { refresh: 1 }).then(() => wb.refresh(['spec']))}>从 rubric 重新读取</Btn>
      </nav>
      <div className="spec-main" ref={main}>
        <section id="overview" className="spec-hero">
          <div className="eyebrow">Benchmark 规范 · 编码与创作能力</div>
          <h1>{S.cfg.name} {S.cfg.version}</h1>
          <p className="lede">一套面向“模型 + harness”的小型基准：{S.tasks.length} 道题覆盖 3D、动画、前端、后端、工程化、需求理解与 Agent 执行，每题配细粒度检查项。能自动验收的全部自动化，必须靠人看的集中盲评，最后输出雷达图、排行榜与效率对比。</p>
          <div className="stats">
            {[[S.tasks.length, '道题（含 1 组 A/C 对照）'], [all.length, '个检查项'], [Math.round((auto / Math.max(1, all.length)) * 100) + '%', '自动检查占比'], [all.filter((i) => i.method === 'human').length, '个人工项'], [S.dims.length, '个雷达维度'], [S.cfg.runs_per_task + ' 次', '每题每参赛者']].map(([b, s]) => (
              <div key={String(s)} className="stat"><div className="stat-v">{b}</div><div className="stat-s">{s}</div></div>
            ))}
          </div>
        </section>

        <section id="principles">
          <div className="eyebrow">为什么这样设计</div>
          <h2>设计原则与闭环</h2>
          <p>benchmark 的本质是用少量样本估计模型在你关心的任务分布上的表现。要估得准，需要同时满足四个条件，并让“定义能力 → 出题 → 执行 → 评分 → 分析 → 修题”这条链能转起来。</p>
          <div className="grid-2">
            <div className="panel"><h3>效度：测你真正关心的</h3><p className="muted small">第一版聚焦编码：前后端、3D、动画、工程化。写作与知识时效暂不纳入。每道题都标明它支撑哪些维度。</p></div>
            <div className="panel"><h3>信度：重测结果稳定</h3><p className="muted small">固定环境与依赖版本、每题每参赛者至少 3 次、自动项占多数、人工项用 4 级锚点并盲评。</p></div>
            <div className="panel"><h3>区分度：避免人人满分</h3><p className="muted small">检查项分基础、进阶、卓越三层；尽量用连续指标而非通过/不通过；隐藏测试含边界、安全与并发；埋入未报告缺陷和需求矛盾。</p></div>
            <div className="panel"><h3>可持续：能长期用下去</h3><p className="muted small">全部使用虚构品牌与原创素材；隐藏测试不公开；题库带版本号；跑完用“题目分析”表替换失去区分度的检查项。</p></div>
          </div>
          <ol className="loop">
            {['定义能力（9 维）', '出题（8 题）', '执行（固定环境 ×3 次）', '评分（自动 + agent + 人工）', '分析（雷达、效率、题目分析）', '修题，回到第一步'].map((s, i, a) => <li key={s} className={i === 3 ? 'here' : undefined}>{s}{i < a.length - 1 && <span className="arr" aria-hidden>→</span>}</li>)}
          </ol>
        </section>

        <section id="dims">
          <div className="eyebrow">雷达图的 {S.dims.length} 条轴</div>
          <h2>雷达维度</h2>
          <p>{qdims.length} 个质量维度按权重合成质量总分；成本效率与速度单独换算，不直接混入质量分。每个维度至少由两道题支撑。</p>
          <div className="grid-3">
            {S.dims.map((d) => {
              const cov = S.tasks.filter((t) => taskDims(t)[d.id]);
              const n = all.filter((i) => i.dim === d.id).length;
              return (
                <div key={d.id} className="panel dimcard">
                  <div className="dim-bar" style={{ background: `var(--d-${d.id})` }} />
                  <h3>{d.name}<span className="muted xs">{d.kind === 'quality' ? `质量 · 权重 ${d.weight ?? 1}` : '效率'}</span></h3>
                  <p className="muted small">{d.desc}</p>
                  <div className="small muted">{d.kind === 'quality' ? `检查项 ${n} 个 · 来源：` : '来源：所有题的用时与费用 '}{cov.map((t) => <button key={t.id} className="tid-chip" onClick={() => jump('task-' + t.id)}>{t.id} · {taskDims(t)[d.id]}</button>)}</div>
                </div>
              );
            })}
          </div>
        </section>

        <section id="matrix">
          <div className="eyebrow">覆盖关系</div>
          <h2>题目 × 维度矩阵</h2>
          <p>格子里是该题对该维度的贡献权重（主要考察 1.0，次要 0.5）与对应检查项数量。维度分 = 各题该维度得分按权重加权平均。</p>
          <div className="panel tw nopad">
            <table className="tbl matrix spec-matrix">
              <thead><tr><th>题目</th>{qdims.map((d) => <th key={d.id} className="c">{d.name}</th>)}<th className="num">检查项</th></tr></thead>
              <tbody>{S.tasks.flatMap((t) => {
                const vs: [string, { dims: Record<string, number> }][] = Object.keys(t.variants || {}).length ? Object.entries(t.variants) : [['', { dims: t.dims }]];
                return vs.map(([vk, v]) => {
                  const its = t.items.filter((i) => !i.variants.length || i.variants.includes(vk));
                  return (
                    <tr key={t.id + vk}>
                      <td><button className="link mono" onClick={() => jump('task-' + t.id)}>{t.id}{vk}</button> {t.name}{vk ? `（${vk} 组）` : ''}</td>
                      {qdims.map((d) => { const w = v.dims[d.id]; const n = its.filter((i) => i.dim === d.id).length; return <td key={d.id} className={cls('c cell', w >= 1 ? 'w1' : w ? 'w05' : '')}>{w ? <>{w}<br /><span className="muted xs">{n} 项</span></> : null}</td>; })}
                      <td className="num">{its.length}</td>
                    </tr>
                  );
                });
              })}</tbody>
            </table>
          </div>
          <h3 className="mt-l">题目之间的关系</h3>
          <div className="grid-3">
            {S.relations.map((r) => <div key={r.title} className="panel"><h3>{r.title}</h3><div className="chips">{r.tasks.map((id) => <button key={id} className="tid-chip" onClick={() => jump('task-' + id)}>{id}</button>)}</div><p className="muted small">{r.text}</p></div>)}
          </div>
        </section>

        <TaskBank />

        <section id="scoring">
          <div className="eyebrow">分数怎么来</div>
          <h2>评分体系</h2>
          <div className="grid-2">
            <div className="panel"><h3>三层评分</h3><ul className="plain">
              <li><b>门槛</b>：能运行、交付物存在、最终汇报与实际一致。任一不过，该次运行记 0 分并进入失败归因。</li>
              <li><b>自动检查</b>：探针直接测量（隐藏测试、浏览器检查、逐帧采样、ffprobe、构建与类型检查），按规则换算为 0–1。</li>
              <li><b>Agent 审查</b>：执行评分 skill 的 agent 阅读代码与文档，按锚点打 0–3 分并附证据，用户可改。</li>
              <li><b>人工评分</b>：只保留必须靠人看的项（观感、创意、手感），集中一次询问、盲评、同一检查项横向比较。</li>
            </ul></div>
            <div className="panel"><h3>防“人人满分”的设计</h3><ul className="plain">
              <li>层级权重：基础 1、进阶 2、卓越 3（可在检查项上单独指定）。</li>
              <li>连续指标：帧率、误差、比例、测试通过率都线性换算，不做一刀切。</li>
              <li>卓越项专门拉开差距：定格节奏、节拍对齐、级分离精度、未报告缺陷、矛盾识别。</li>
              <li>扣分项（clean）：报错、占位代码、PIN 明文等，满分表示“干净”。</li>
              <li>报告中单列“分层得分”：基础项都满分时，差距体现在进阶与卓越层。</li>
            </ul></div>
            <div className="panel"><h3>换算规则</h3>
              <table className="tbl"><thead><tr><th>规则</th><th>含义</th></tr></thead><tbody>
                {[['bool', '为真（或指定期望值）得 1'], ['ratio', '比例直接作为得分'], ['min / max', '达到阈值得 1；给出 zero 时在阈值与 zero 之间线性'], ['linear', '从 bad 到 good 线性映射，可选对数刻度'], ['band', '落在区间内得 1，偏离 tol 记 0'], ['eq', '等于目标值得 1'], ['锚点 0–3', '人工与 agent 项，除以 3']].map(([a, b]) => <tr key={a}><td className="mono">{a}</td><td>{b}</td></tr>)}
              </tbody></table>
            </div>
            <div className="panel"><h3>状态处理</h3><ul className="plain">
              <li><b>缺失</b>：被测产出没有提供该指标（接口没实现、文件不存在），记 0 分。</li>
              <li><b>N/A</b>：评测环境原因无法检查（没装 ffmpeg、无法访问 npm），不计入分母；占比超过 {Math.round((S.cfg.low_confidence_na_ratio || 0.2) * 100)}% 标记“低可信”。</li>
              <li><b>待评</b>：人工或 agent 项还没打分，不计入分母，报告标注“评分不完整”。</li>
            </ul></div>
          </div>
          <h3 className="mt-l">从检查项到排行榜</h3>
          <pre className="formula">{`检查项得分  s ∈ [0,1]           （规则换算；人工/agent 为 0–3 分 ÷ 3）
单次维度分  = 100 × Σ(w·s) / Σw   （只计该维度的检查项；门槛不过则全部为 0）
单次总分    = 100 × Σ(w·s) / Σw   （该次运行的全部检查项）
题目维度分  = 该参赛者该题多次运行的均值
参赛者维度分 = Σ(题目权重 × 题目维度分) / Σ题目权重    （主要考察 1.0，次要 0.5）
质量总分    = Σ(维度权重 × 维度分) / Σ维度权重          （${qdims.length} 个质量维度）`}</pre>
          <div className="grid-2">
            <div className="panel"><h3>效率维度</h3><p className="muted small">期望成功成本 = 单次平均费用 ÷ 达标率（单次总分 ≥ {S.cfg.pass_threshold} 且门槛通过视为达标）。按对数刻度换算：≤ {ef.cost.best} 美元记 100 分，≥ {ef.cost.worst} 美元记 0 分。速度同理：期望达标用时 ≤ {ef.speed.best} 分钟记 100 分，≥ {ef.speed.worst} 分钟记 0 分。锚点固定，新增模型时老模型分数不变。另附帕累托图，不强行把效率并入质量分。</p></div>
            <div className="panel"><h3>统计与并列</h3><p className="muted small">对每个参赛者，在各题内部重抽运行（bootstrap，默认 {S.config_full.statistics?.bootstrap_samples || 2000} 次）得到质量总分的 95% 置信区间。与上一名次首位的区间重叠的，记为并列（名次后加“=”）。同时报告每题标准差、最低/最高分与 pass@k。</p></div>
          </div>
        </section>

        <section id="protocol">
          <div className="eyebrow">怎么跑</div>
          <h2>运行协议</h2>
          <div className="grid-2">
            <div className="panel"><h3>环境与次数</h3><ul className="plain">
              <li>每个“模型 @ harness”每题跑 <b>{S.cfg.runs_per_task}</b> 次，全部从干净工作目录开始（工作台为每次运行新建 <code>model/&lt;供应商&gt;/&lt;模型&gt;/&lt;题号&gt;/rN/</code>）。</li>
              <li>固定工具集、依赖版本、Chromium 版本与时间上限（见各题卡片）。</li>
              <li>无人值守题目不回答模型提问；T06 为有人值守，评测者只按意图表作答。</li>
              <li>T03 A 组环境中不得存在任何动画/视频 skill；C 组预装同一版本 HyperFrames skills。</li>
              <li>把模型最后一条回复保存为 final_message.md，用于核对汇报是否属实。</li>
            </ul></div>
            <div className="panel"><h3>人工评分怎么收集</h3><ul className="plain">
              <li>全部自动评分跑完后，一次性生成评分包：review/index.html（可直接打分并导出 CSV）与 human_sheet.csv；或直接在工作台“评审”页打分。</li>
              <li>运行名替换为 R001 这类别名，同一检查项的所有运行并排展示，横向比较。</li>
              <li>动画题使用统一管线逐帧渲染的评审视频，避免各家渲染环境差异。</li>
              <li>Agent 项先由评分 agent 填写并附证据，用户确认或修改。</li>
            </ul></div>
            <div className="panel"><h3>用时与成本从哪来</h3><ol className="plain">
              <li>用户在登记运行时直接提供（最优先）。</li>
              <li>否则解析评测机上的 harness 本地日志：Claude Code（~/.claude/projects）、Codex CLI（~/.codex/sessions）、Gemini CLI（~/.gemini/tmp），按工作目录与时间窗口匹配会话，统计墙钟时间、有效时间（扣除等待人回复的间隔）与 token。</li>
              <li>token 乘以 config/prices.yaml 中的单价得到估算费用（订阅制 harness 也按 API 等价价格估算并标注）。</li>
              <li>仍然缺失的汇总到 usage_needed.csv，一次性请用户补填。</li>
            </ol></div>
            <div className="panel"><h3>开跑前要准备的素材</h3><ul className="plain">
              {S.tasks.filter((t) => t.materials.length).map((t) => {
                const ms = S.materials_state?.[t.id];
                return <li key={t.id}><button className="tid-chip" onClick={() => jump('task-' + t.id)}>{t.id}</button> {t.materials.join('；')} {ms && (ms.missing.length ? <Badge tone="warn">缺 {ms.missing.length}</Badge> : <Badge tone="ok">已就绪</Badge>)}</li>;
              })}
              <li>运行 <code>python scripts/build_materials.py</code>（或“系统 → 生成素材”）可重新生成 T03/T04 的统一音频与文案素材（确定性，所有模型拿到相同文件）。</li>
              <li>T04 需要在评测机上预装同一个 TTS 命令，并替换提示词中的 <code>{'{TTS_COMMAND}'}</code>（在“系统 → 设置”填写后，工作台生成提示词时自动替换）。</li>
            </ul></div>
          </div>
        </section>

        <section id="exports">
          <div className="eyebrow">产出</div>
          <h2>导出表格</h2>
          <p>所有表格同时导出 CSV（UTF-8 BOM，Excel 可直接打开）、汇总到一个 benchmark.xlsx 的各个工作表，排行榜另有 Markdown 版与单页 HTML 报告。工作台导出到 <code>reports/&lt;时间&gt;-&lt;标签&gt;/</code>，并附带存储文件快照。</p>
          <div className="panel tw nopad"><table className="tbl"><thead><tr><th>文件</th><th>内容</th><th>用途</th></tr></thead><tbody>
            {EXPORTS.map(([a, b, c]) => <tr key={a}><td className="mono">{a}</td><td>{b}</td><td>{c}</td></tr>)}
          </tbody></table></div>
        </section>

        <section id="tooling">
          <div className="eyebrow">bench-grader skill + 工作台 CLI</div>
          <h2>评分工具</h2>
          <p>评分规则、探针与导出都封装在 bench-grader skill 中。本页由其中的 rubric 自动生成；工作台 CLI <code>wb</code> 在此之上提供模型工作区、计时、登记、评分、预览与报错读取，供 Agent 调用（见 <code>skills/bench-workbench/SKILL.md</code>）。</p>
          <div className="grid-2">
            <div><h3>bench-grader</h3><pre className="formula">{`python scripts/bench.py doctor                         # 检查评测机依赖
python scripts/bench.py init-run --task T07 --model "模型名" --harness "Claude Code" \\
    --src ./workdir/studyspot-api --final-message final.md --workspace ./workdir
python scripts/bench.py grade --all                    # 自动评分
python scripts/bench.py review                         # 生成人工/agent 评分包 + 用量缺失清单
python scripts/bench.py ingest-scores human_scores.csv # 导入人工评分
python scripts/bench.py ingest-usage review/usage_needed.csv
python scripts/bench.py aggregate
python scripts/bench.py export --formats csv,md,xlsx,png,html
python scripts/bench.py build-spec --out benchmark-spec.html`}</pre></div>
            <div><h3>工作台 CLI</h3><pre className="formula">{`wb run new OpenAI/GPT-6.1-Sol T05 --harness "Codex CLI"
wb run start OpenAI/GPT-6.1-Sol/T05/r1
wb run finish OpenAI/GPT-6.1-Sol/T05/r1 --final-file final.md --register
wb pending --method agent --json          # Agent 审查项清单
wb score <run_id> <item_id> 2 --note "证据" --by agent
wb check OpenAI/GPT-6.1-Sol/T05/r1 --mobile --json   # 无头加载：报错 + 截图
wb board --json | wb compare GPT Claude
wb export`}</pre></div>
          </div>
        </section>
      </div>
    </div>
  );
}

const EXPORTS: [string, string, string][] = [
  ['leaderboard', '名次、质量总分与置信区间、9 维得分、达标率、整套期望成本与用时', '对外发布的主表'],
  ['radar.png / radar_NN.png', '全部参赛者叠加雷达图 + 每个参赛者单独一张', '一图看强弱项'],
  ['task_matrix / tasks', '参赛者 × 题目的均值 ± 标准差、最低最高、pass@k、门槛失败次数', '看稳定性与单题表现'],
  ['task_dims', '参赛者 × 题目 × 维度', '追溯维度分来源'],
  ['tiers', '基础 / 进阶 / 卓越 / 扣分项分层得分率', '基础项都满分时看差距在哪一层'],
  ['efficiency / pareto.png', '单次费用与用时、达标率、期望成功成本、帕累托前沿', '选“性价比”模型'],
  ['skill_uplift', 'T03 A/C 两组得分、动画分、费用与用时之差', '衡量 skill 带来的增益'],
  ['failures', '门槛失败与未达标运行的失败归因', '区分模型问题与 harness/环境问题'],
  ['item_analysis', '每个检查项的平均分、参赛者间与参赛者内标准差、天花板/地板/区分度低标记', '迭代题库'],
  ['coverage', '题目 × 维度权重与检查项数', '检查覆盖是否均衡'],
  ['runs / item_scores_long', '每次运行的得分、token、费用、来源；每个检查项的原始值与得分', '审计与二次分析'],
  ['report.html', '单页汇总报告（内嵌图表）', '直接分享'],
];

function taskDims(t: SpecTask) {
  const out: Record<string, number> = { ...t.dims };
  for (const v of Object.values(t.variants || {})) for (const [k, w] of Object.entries(v.dims || {})) out[k] = Math.max(out[k] || 0, w);
  return out;
}

function TaskBank() {
  const { spec } = useWb();
  const S = spec!;
  const qdims = S.dims.filter((d) => d.kind === 'quality');
  const [dims, setDims] = useState<Set<string>>(new Set());
  const [method, setMethod] = useState('');
  const [tier, setTier] = useState('');
  const [q, setQ] = useState('');
  const all = S.tasks.flatMap((t) => t.items);
  const match = (i: SpecItem) => (!dims.size || dims.has(i.dim)) && (!method || i.method === method) && (!tier || i.tier === tier) && (!q || `${i.id} ${i.desc} ${i.metric} ${i.rule}`.toLowerCase().includes(q.toLowerCase()));
  const shown = all.filter(match).length;
  return (
    <section id="tasks">
      <div className="eyebrow">题库 {S.cfg.version}</div>
      <h2>题库与评分细则</h2>
      <p>每道题包含：发给模型的原文提示词、门槛条件、全部检查项（维度、层级、方式、权重、换算规则）、人工/agent 项的 0–3 分锚点。用下方筛选条按维度、方式、层级或关键词过滤检查项。</p>
      <div className="filters">
        {qdims.map((d) => <button key={d.id} className={cls('fchip', dims.has(d.id) && 'on')} aria-pressed={dims.has(d.id)} onClick={() => { const s = new Set(dims); if (s.has(d.id)) s.delete(d.id); else s.add(d.id); setDims(s); }}><i className="dot" style={{ background: `var(--d-${d.id})` }} />{d.name}</button>)}
        <select value={method} onChange={(e) => setMethod(e.target.value)} aria-label="评分方式"><option value="">全部方式</option><option value="auto">自动</option><option value="agent">Agent 审查</option><option value="human">人工</option></select>
        <select value={tier} onChange={(e) => setTier(e.target.value)} aria-label="层级"><option value="">全部层级</option><option value="basic">基础</option><option value="advanced">进阶</option><option value="excellent">卓越</option><option value="clean">扣分项</option></select>
        <div className="search-in"><Search size={13} /><input placeholder="搜索检查项、指标或编号" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <span className="muted small mono">显示 {shown} / {all.length} 项</span>
      </div>
      {S.tasks.map((t) => <TaskCard key={t.id} t={t} match={match} />)}
    </section>
  );
}

function TaskCard({ t, match }: { t: SpecTask; match: (i: SpecItem) => boolean }) {
  const { spec, store } = useWb();
  const [tab, setTab] = useState<'items' | 'prompt' | 'how'>('items');
  const [variant, setVariant] = useState(Object.keys(t.variants || {})[0] || '');
  const [prompt, setPrompt] = useState<{ text: string; warnings: string[] } | null>(null);
  const [newRun, setNewRun] = useState(false);
  useEffect(() => { if (tab === 'prompt') get<{ text: string; warnings: string[] }>('/api/ws/prompt', { task: t.id, variant: variant || undefined }).then(setPrompt, () => setPrompt({ text: t.prompt, warnings: [] })); }, [tab, variant, t.id, t.prompt, store?.settings.tts_command]);
  const items = t.items.filter(match);
  const methods = (['auto', 'agent', 'human'] as const).map((m) => `${METHOD_LABEL[m]} ${t.items.filter((i) => i.method === m).length}`).join(' · ');
  const sumTier = (['basic', 'advanced', 'excellent', 'clean'] as const).map((tr) => { const its = t.items.filter((i) => i.tier === tr); return its.length ? `${TIER_LABEL[tr]} ${its.length} 项 / 权重 ${its.reduce((a, b) => a + b.weight, 0)}` : ''; }).filter(Boolean).join(' · ');
  const runs = (store?.workspaces || []).filter((w) => w.task === t.id).length;
  return (
    <article className="task-card" id={`task-${t.id}`}>
      <header>
        <div className="row gap-s wrap"><span className="mono accent big-id">{t.id}</span><h3>{t.name}</h3><div className="grow" />{runs > 0 && <Badge>{runs} 次运行</Badge>}<Btn size="sm" icon={<Play size={13} />} onClick={() => setNewRun(true)} disabled={!store?.models.length}>用此题新建运行</Btn></div>
        <p className="muted">{t.short}</p>
        <div className="chips">
          {Object.keys(t.variants || {}).length ? Object.entries(t.variants).map(([k, v]) => <span key={k} className="row gap-xs wrap"><b>{k} 组</b><span className="muted small">{v.desc}</span>{Object.entries(v.dims).map(([d, w]) => <DimChip key={d} id={d} w={w} />)}</span>) : Object.entries(t.dims).map(([d, w]) => <DimChip key={d} id={d} w={w} />)}
        </div>
        <div className="facts"><span>交付目录 <b className="mono">{t.deliverable}/</b></span><span>时间上限 <b>{t.time_limit || '—'} 分钟</b></span><span>检查项 <b>{t.items.length}</b>（{methods}）</span></div>
      </header>
      <div className="tabs" role="tablist">
        {([['items', '评分细则'], ['prompt', '提示词原文'], ['how', '运行与评测方式']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'items' && (
        <div className="pane-pad">
          <div className="gates"><b>门槛</b>（任一不过，该次运行记 0 分）：{t.gates.map((g) => `${g.id} ${g.desc}${g.variants.length ? '（仅 ' + g.variants.join('/') + ' 组）' : ''}`).join('；')}</div>
          <div className="muted small mono mb-s">{sumTier}</div>
          <div className="tw">
            <table className="tbl items">
              <thead><tr><th>编号</th><th>维度</th><th>层级</th><th>方式</th><th className="num">权重</th><th>检查内容 / 指标</th><th>换算规则</th></tr></thead>
              <tbody>{items.map((i) => (
                <tr key={i.id}>
                  <td className="mono nowrap">{i.id}{i.variants.length > 0 && <span className="v-tag">仅{i.variants.join('/')}</span>}</td>
                  <td><DimChip id={i.dim} /></td>
                  <td className={`tier-${i.tier} small nowrap`}>{i.tier_label}</td>
                  <td className={`m-${i.method} small nowrap`}>{i.method_label}</td>
                  <td className="num">{i.weight}</td>
                  <td className="desc">{i.desc}{i.metric && <span className="metric">{i.metric}</span>}{i.evidence && <div className="muted xs">依据：{i.evidence}</div>}
                    {i.anchors.length > 0 && <div className="anchors sm">{i.anchors.map((a, k) => <div key={k} className={`anchor s${k}`}><b>{k}</b>{a}</div>)}</div>}</td>
                  <td className="muted small rule">{i.rule}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {!items.length && <p className="muted small">当前筛选条件下本题没有匹配的检查项。</p>}
        </div>
      )}
      {tab === 'prompt' && (
        <div className="pane-pad stack">
          <div className="row gap-s">
            {Object.keys(t.variants || {}).length > 0 && <Seg value={variant} onChange={setVariant} options={Object.keys(t.variants).map((v) => ({ value: v, label: `${v} 组` }))} />}
            <CopyBtn text={() => prompt?.text || t.prompt} label="复制发给模型的提示词" tone="primary" />
            <CopyBtn text={t.prompt} label="复制原文" />
            <span className="muted small">{t.id === 'T06' ? '有人值守题：只发送分隔线以下部分。' : variant ? `已删除另一组的条件段。` : ''}</span>
          </div>
          {prompt?.warnings.map((w, i) => <div key={i} className="alert warn">{w}</div>)}
          <pre className="prompt">{prompt?.text ?? t.prompt}</pre>
        </div>
      )}
      {tab === 'how' && (
        <div className="pane-pad">
          <dl className="kv">
            <div className="kv-r"><dt>运行条件</dt><dd>{t.condition}</dd></div>
            <div className="kv-r"><dt>预置素材</dt><dd>{t.materials.length ? t.materials.map((m) => <div key={m}>{m}</div>) : '无'}{spec?.materials_state?.[t.id] && <div className="muted small">目录 <code>{spec.materials_state[t.id].dir}</code>{spec.materials_state[t.id].missing.length ? <Badge tone="warn">缺 {spec.materials_state[t.id].missing.join('、')}</Badge> : null}</div>}</dd></div>
            <div className="kv-r"><dt>自动探针</dt><dd className="mono small">{t.probes.join(' · ')}</dd></div>
            <div className="kv-r"><dt>评测方私有材料</dt><dd className="mono small">{t.hidden.length ? t.hidden.map((h) => <div key={h}>{h}</div>) : '无'}</dd></div>
          </dl>
          {t.bugs && (
            <>
              <h4 className="mt-l">注入缺陷（评测方私有）</h4>
              <table className="tbl"><thead><tr><th>编号</th><th>来源</th><th>现象</th><th>根因</th><th>对应隐藏测试</th></tr></thead>
                <tbody>{Object.entries(t.bugs).map(([k, b]) => <tr key={k}><td className="mono">{k}</td><td>{b.issue}</td><td>{b.title}</td><td>{b.root}</td><td className="mono small">{b.test}</td></tr>)}</tbody></table>
            </>
          )}
        </div>
      )}
      {newRun && <NewRunModal open onClose={() => setNewRun(false)} preset={{ task: t.id, variant: variant || undefined }} />}
    </article>
  );
}
