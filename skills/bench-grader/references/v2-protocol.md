# Coding Bench v2.0 协议

v1.0 已冻结为“历史版”：题库、分数、榜单口径一律不变（仅在 `data/v1.1-errata.json` 里登记评分器勘误，不回改历史分）。
v2.0 是另起的题库（`rubric.yaml` 里 `suite: v2`），独立出榜。

## 1. 三层评分

| 层 | 内容 | 方式 |
|---|---|---|
| Tier0 可用性 | 页面能加载、无未捕获异常、非空白、核心交互不崩 | 自动；失败不清零，该次运行总分与各维度分封顶到 `v2.tier0_cap`（默认 40），`tier0_pass=false` |
| L1 脚本合规 | 契约（构建/启动/目录/交接文档/依赖）是否满足 | 自动，沿用 gates 与 auto 项 |
| L2 体验 | 交互走查、基础版/细节版、模块 | 人工（可用多模态预填）+ 自动探针；两两比较用 `judge: pairwise` |
| L3 Agent 验收 | 8 个板块，见 `agent-acceptance.md` | agent 项 |

rubric 项新增字段（均可选）：

- `edition: base | detail`：基础版（先看“崩没崩、能不能用”）与细节版（模块级细节）。展示在 `score.editions`，不改总分公式。
- `module: <名>`：细节模块，如 `engine`、`nozzle`。展示在 `score.modules`。
- `judge: absolute | pairwise`：人工项评分方式。pairwise 项由两两比较的结果经 Bradley-Terry 折算为 0–3 后写入 `manual_scores.json`。
- 顶层 `tier0:`（与 `gates:` 同格式）、`suite: v1|v2`。

v2 题 rubric 顶层还有：

- `kind: creative | backend | motion`（必填）。`validate-rubrics` 据此检查提示词小节：creative / motion 要 `## 契约` 与 `## 愿望` 两节，backend 只要 `## 契约`。
- `capture:` 命名视角与部件树的采集配置，由 browser 探针使用（见 `probes.md` 的 capture 段）：
  ```yaml
  capture:
    hooks: {views: __bench.views, set_view: __bench.setView, parts: __bench.listParts, scene: __scene, renderer: __renderer}
    views: [{id: front, label: 正面}, {id: top, label: 俯视}]   # id 唯一；页面需实现 __bench.setView(id)
    parts: {min_parts: 12}                                     # __bench.listParts() 至少返回的部件数
    orbit: {frames: 36}                                        # 环绕视频帧数
  ```
- 两两比较：`judge: pairwise` 的人工项，用 `bench.py ingest-pairwise comparisons.csv`（列：`task,item_id,a,b,winner`，a/b 可用盲评别名）导入；Bradley–Terry 拟合后在同题同检查项内线性映射到 0–3 写入 `manual_scores.json`（`by: pairwise`）。

## 2. 提示词两层

- **契约层**（只写交付位置、启动方式、交接文档、依赖许可、可被脚本检查的最小接口）。
- **愿望层**（只写“想看到什么”，不列部件清单、不限制实现手段、不限制模型能力）。
- 不得有聊天式输出约束（“最后只回复一句话”之类）；时限为软时限，超过只在用时上体现。
- 前端/创作题愿望化；后端题保持精确契约（接口可测）。
- **严禁在愿望层指定风格**：视觉风格、配色、题材走向、受众与平台、情绪基调、材质与细节清单，一律由模型自行分析决定；可以说明“也可以结合叙事”。例外：题目本身的身份（如 V03 明确要求 Minecraft 风格与三幕叙事、V06 要求照片级写实）与素材事实（文案、事实表）不算风格限制。
- **视频 / 动画不设时长上限**：提示词只给“推荐时长”，多了少了都可以；评分里不设“时长误差”项，实际时长只作记录。技术规格（分辨率、帧率、编码、响度等）属于契约，可以保留。
- **统一愿望模板**（V 组每题末尾使用）：技术不限（JavaScript、WebGL、Three.js 等），请尽最大努力：1）视觉惊艳、艺术性顶尖；2）内容高级、有深刻含义；3）转场与衔接自然，可一镜到底，或至少有主线、不突兀；4）观众感到大师之作，并震惊于这是用代码生成的；5）不限 token，尽可能炫技。
- `capture.motion` 可用 `fractions`（时长比例）代替写死的 `times`，使时间点随作品时长伸缩。

## 3. 数据字段

`meta.json` 新增：

- `benchmark_version`：由 `rubric.suite` 决定（v1 题 → `v1.0`，v2 题 → `v2.0-draft`/`v2.0`）。没有该字段的旧运行视为 v1.0。
- `incident`：`null` 或 `{kind, reason, date}`，`kind ∈ tier0 | harness | interrupted | other`。

事故只由评测者用 `bench.py mark-incident <run_id> --kind … --reason …` 标注：

- 简化版：事故运行允许重测，榜单标注重测次数；
- 完整版：事故不剔除，计入稳定性。

## 4. 三个榜单视图

| 视图 | 数据 | 规则 |
|---|---|---|
| 历史版 `history` | v1.0 运行 | 与冻结口径一致 |
| v2 简化版 `simple` | v2 运行 | 每题取最高分（至多 3 次，其余为事故重测）；榜单 `n=1–3`，n>1 标 `*`；可筛选“仅 n=1” |
| v2 完整版 `full` | v2 运行 | 只收“每道 v2 题都测满 `v2.full_runs` 次”的参赛者，未满者列在“未入榜”并给出缺口；每题只取前 3 次，不挑分；稳定性为雷达轴（不进质量总分） |

稳定性 = 50% 可用率（Tier0 通过的运行占比；无 Tier0 的题退化为“门槛通过且总分>0”）+ 50% 一致性（`100 − 2 × 各题运行分标准差的均值`，截断到 0–100）。

命令：

```
python scripts/bench.py aggregate --view history|simple|full
python scripts/bench.py export --view simple --formats csv,md
python scripts/bench.py mark-incident <run_id> --kind harness --reason "CLI 启动失败"
python scripts/bench.py mark-incident <run_id> --clear
```

输出：`results/aggregate.json`（history）、`results/aggregate-simple.json`、`results/aggregate-full.json`。

## 5. 评测机

同一台机器、同一 GPU 渲染器。帧率/渲染耗时类指标只在 `browser.gl_renderer` 相同时可比；不同则这些指标标 N/A。

## 6. 运行规则

- v2 沿用 AGENTS.md 的并发、隔离、暂停规则；模型一律只做首轮，简化版先覆盖全部候选模型，再对选定模型补满到 3 次生成完整版。
- 不允许为抬分重跑：简化版“取最高”是协议内的规则（每题至多 3 次），重测次数在榜单上可见。

## 7. v2 任务清单

| 编号 | 题目 | 类别 | 承接 v1 | 备注 |
|---|---|---|---|---|
| V01 | 鹈鹕骑自行车 | creative | T01 | 契约 + 愿望 |
| V02 | 自行车 | creative | — | 传动 / 部件树 / 接触 |
| V03 | Minecraft 定格短片 | creative + skill | T02 | 骨架完整性、Skill 遵循（契约内可验证部分） |
| V04 | Aether-9 3D 官网 | creative | T05 | 部件树 + 逐件拆分 + 参数一致 |
| V05 | 方块世界宏大建筑 | creative | 新 | 体素审计 |
| V06 | 逼真建筑 | creative | 新 | 以两两比较为主，脚本只排除信息贫乏画面 |
| V07 | Tempo 动效短片（A/C） | motion | T03 | 取消密度类指标，踩点交人工 |
| V08 | Aether-9 发布宣传片 | motion + agent | T04 | 取消切换密度 |
| B1–B8 | 后端题族 | backend | T07 / T08 | 见 backend-suite（references/backend-suite.md） |

素材：V03 的 skill 包随题目目录；V07 / V08 的音频素材由 scripts/build_materials.py 与 T03 / T04 一并确定性生成（逐字节相同）。

### T06 的处理

T06（StudySpot 需求澄清，有人值守）**不并入 v2 榜单**：它要求操作员按 hidden/intent.md 实时回答模型提问，样本之间无法做到可复现，不适合“简化版取最优 / 完整版三次”的统计口径。T06 保留在历史版，数据不变；v2 里“需求澄清”能力由 Agent 验收的“自我验证与过程遵循”板块（agent-acceptance.md）覆盖。T07 / T08 的能力分别由后端题族的“协议实现”“大型遗留代码调试”承接，不重复入榜。
## 8. v2 探针（capture / scene_audit / voxel_audit）

三个探针都只读页面公开状态（命名视角、`window.__scene`、鼠标拖动），不数网格 / 三角面 / 材质种类，不对建模手段打分。

| 探针 | 指标 | 说明 |
|---|---|---|
| `capture` | `capture.default_nonblank` / `views_rendered_ratio` / `views_distinct_ratio` / `orbit_ok` / `expected.<module>` / `parts.count` / `entropy_mean` / `dynamic_range_mean` / `dusk_luma_shift` | 逐个 `__bench.setView(id)` 取景并截图，鼠标拖动做环绕检查（扣除画面自身的自动运动），按 `capture.expected_parts` 的正则在部件树 + 场景节点名里找名字。产物放 `_grading/capture/`（`view_<id>.png`、`orbit_NN.png`、`orbit.mp4`、`manifest.json`），评分页读取它们 |
| `scene_audit` | `rig.floating_ratio` / `deep_clip_ratio` / `motion_floating_max` / `contacts_ok_ratio` | 以网格世界包围盒（AABB）为部件：连通性判断散架，体量相当且互不为祖先的部件包围盒 ≥ 70% 重叠判断严重穿插，`capture.contacts` 判断关键接触（`tol` 是主体对角线的比例）。时间线题用 `capture.motion: {seek, times}` 在多个时刻重复审计；其他题用 `samples/interval_ms`。非 three.js 作品（没有 `__scene`）这些指标标 N/A，不扣分也不加分 |
| `voxel_audit` | `voxel.available` / `aligned_ratio` / `uniform_ratio` / `extent_*` / `height_levels` / `interior_void_ratio` / `palette_size` | InstancedMesh 取实例，普通网格取轴对齐外露面推出格子；格点偏移取众数；结构 = 高于地面层的最大 6 邻接连通块；房间 = 外露空气里到不了外部的部分 |

局限（必须如实告知读榜单的人）：AABB 是粗筛，连通不等于真的接触，重叠不等于真的穿模，所以相关检查项只抓严重缺陷并留有余量，真正的“手握住武器”“脚踩住地面”由人工项判断；体素审计要求使用 three.js 并把世界放进 `__scene`。

`creative-rig.yaml` 只给“有主体、有结构”的题（V01–V04）；建筑 / 体素世界题（V05、V06）里有大量独立物件，不引入 rig 检查。
## 9. 评分页（盲评）

`python scripts/bench.py review` 生成 `review/index.html`（只显示盲评别名），`wb review` 同效。页面有三块：

1. **两两比较**：rubric 里 `judge: pairwise` 的人工项，在同题同检查项下自动配对（n ≤ 5 全配；更多时先连成环再给每个作品补随机对手，每个作品至少 3 次；A/B 位置由种子决定，重复生成结果一致）。成对展示同一命名视角的截图、环绕视频，选“A 更好 / 差不多 / B 更好”。导出 `pairwise.csv`，用 `bench.py ingest-pairwise review/pairwise.csv`（或 `wb ingest pairwise review/pairwise.csv`）导入，Bradley–Terry 折算成 0–3 分。同题只有一个作品时，退回绝对打分。
2. **固定交互走查清单**（所有 `*-H00`）：10 项固定清单逐项选“通过 / 失败 / 不适用”，页面按失败数给出建议分，最终分数由人决定；失败项编号写进备注。清单可以在 rubric 里用 `walkthrough:` 覆盖。
3. **多模态预填与探索报告**：`review/agent_prefill_request.json` 列出每个人工项要看的图片 / 视频与锚点，交给多模态模型，它把建议写回 `review/agent_prefill.json`（绝对分或两两胜负）。建议只显示在评分按钮旁边，由人点“采纳”或自己评；导出 CSV 记录 `prefill_score` 和 `prefill_adopted`，页头显示“与 AI 预填一致 x / y”，供校准多模态与人工的一致性。能打开页面的 agent 另外把逐控件的点击发现写到 `review/exploration/<别名>.md`，折叠显示在对应作品卡片里。

预填和探索报告永远只是辅助：不自动写入 `manual_scores.json`，也不改变盲评规则。

## 10. Agent 验收（八个板块）

V01–V06 的 agent 维度引入 _common/agent-acceptance.yaml（条目 AC01–AC15），探针为 hygiene / boundary / evidence / explore（外加既有的 claims 与 build）。板块、判分、越界线索的复核流程、探索测试格式与校准方法见 agent-acceptance.md。

命令：`bench.py ingest-exploration`、`bench.py agent-sample`、`bench.py agent-calibration`（对应 `wb ingest exploration|sample|calibration`）。