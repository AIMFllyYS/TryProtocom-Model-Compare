---
name: bench-grader
description: 个人 Coding Bench 的自动化验收与评分流水线。用于登记模型运行结果、自动评分（隐藏测试/浏览器/逐帧/视频/构建探针）、汇总人工与 agent 评分、从本地 harness 日志统计用时与成本，并导出排行榜、雷达图、效率与题目分析等 benchmark 表格。触发词：benchmark 评分、跑分、验收模型产出、导出榜单、雷达图、T01–T08。
---

# bench-grader

Coding Bench v1 的评分工具。8 道题（T01–T08）、7 个质量维度 + 2 个效率维度、264 个检查项。评分规则全部写在 `tasks/*/rubric.yaml`，本文件只描述**怎么跑**。

脚本、题库与配置随 `bench-grader.zip` 分发。如果当前环境里找不到本 skill 的 `scripts/` 与 `tasks/` 目录，先请用户提供该压缩包并解压到工作目录，再按下文操作。

## 不可违反的规则

1. **隐藏材料不外泄**：`tasks/*/hidden/`（隐藏测试、参考实现、意图表）只给评测方用，绝不放进被测模型的工作目录或提示词。
2. **不伪造分数**：人工项只能来自用户；agent 项必须附证据（文件名 + 行号或具体现象）；无法检查的项保持 N/A 或待评，不能随手填分。
3. **统一询问**：所有需要用户提供的东西（人工评分、缺失的用时成本、缺失的运行信息）**攒到一次**集中询问，不要逐条打断用户。
4. **汇报如实**：向用户汇报时区分“自动评分完成 / 待人工 / N/A / 低可信”，不要把未完成的评分说成最终结果。

## 目录

```
config/        dimensions.yaml（雷达维度与权重）、benchmark.yaml（阈值、效率锚点、外部路径）、prices.yaml（单价，需用户填写）
tasks/Txx-*/   prompt.md（发给模型的原文）、rubric.yaml（门槛+检查项+探针配置）、materials/（预置素材）、hidden/（私有）
scripts/       bench.py（命令行入口）、build_materials.py、benchlib/（探针、评分、汇总、导出、规范页）
assets/        spec_template.html（规范页模板）
references/    详细说明，按需阅读（见文末）
```

## 标准流程

### 0. 准备（每台评测机一次）
```bash
pip install pyyaml playwright pillow numpy openpyxl matplotlib pytest   # --break-system-packages 视环境而定
python scripts/bench.py doctor
```
- 缺 ffmpeg / npm / Chromium 的项会变成 N/A；`doctor` 会提示。
- 可选：`npm i axe-core`（无障碍检查），`pip install faster-whisper`（T04 语音转写）。
- 外部路径写进 `config/benchmark.yaml` 的 `external`，或用环境变量 `BENCH_MINECRAFT_SKILL`、`BENCH_AXE_JS` 覆盖。
- 首次使用时请用户按官方价格填写 `config/prices.yaml` 并注明日期；没有单价只能统计 token，费用会列入待补。
- 运行 `python scripts/build_materials.py` 生成 T03/T04 的统一素材。

### 1. 登记运行
每次模型跑完一道题，登记一次（运行 id 不含模型名，便于盲评）：
```bash
python scripts/bench.py --data bench-data init-run --task T07 --model "模型名" --harness "Claude Code" \
  --src <模型交付的文件夹> --final-message <最后一条回复.md> --workspace <模型运行时的工作目录> \
  --started-at 2026-10-08T10:00:00+08:00 --ended-at 2026-10-08T10:40:00+08:00
```
- T03 加 `--variant A` 或 `--variant C`；T06 加 `--transcript transcript_notes.json`（评测者按 `hidden/intent.md` 记录的提问情况）。
- 用户已知用时/费用时直接写进 `--extra '{"usage": {"wall_min": 32, "cost_usd": 1.8}}'`。
- 缺少 `--final-message` 时诚信门槛记 N/A（不判失败），但要在汇报中说明。

### 2. 自动评分
```bash
python scripts/bench.py --data bench-data grade --all          # 全量；--fast 跳过评审视频渲染；--skip-graded 只重算分
```
- 每个运行生成 `metrics.json`（原始指标）和 `score.json`（逐项得分、门槛、维度分、N/A 占比、待评项）。
- 耗时参考（软件渲染 WebGL）：后端题约 15 秒/次；动画题 2–5 分钟/次（含逐帧采样与评审视频）。
- 探针崩溃会记录在 `metrics.json.notes`，对应项按“缺失”计 0 分。先检查是不是评测环境的问题（环境问题应改成 N/A 并修环境后重跑）。

### 3. Agent 审查项
```bash
python scripts/bench.py --data bench-data review
```
生成 `review/agent_sheet.csv`。逐行阅读对应运行的产出（`open` 列给出路径），按该行 4 级锚点打 0–3 分，`note` 写证据（文件:行号 / 现象）。填完后：
```bash
python scripts/bench.py --data bench-data ingest-scores review/agent_sheet.csv --by agent
```
不确定的项留空，交给用户在第 4 步决定。

### 4. 一次性向用户收集：人工评分 + 缺失用时成本
`review` 同时生成：
- `review/index.html`：盲评页面，同一检查项的所有运行并排显示（截图、评审视频、作品链接），点选 0–3 分后导出 `human_scores.csv`；
- `review/human_sheet.csv`：同样内容的表格版；
- `review/usage_needed.csv`：本地日志也找不到用时/费用的运行。

用时成本来源顺序（详见 `references/time-and-cost.md`）：用户登记值 → 本地日志（Claude Code `~/.claude/projects`、Codex `~/.codex/sessions`、Gemini CLI `~/.gemini/tmp`，按工作目录与时间窗口匹配）→ 请用户补。如果会话连接着用户电脑，先在用户电脑上解析日志（把日志目录暂存进来或在其 shell 中运行本脚本），仍缺失才询问。

**询问方式**：把 `review/index.html`、`human_sheet.csv`、`usage_needed.csv` 一起发给用户，说明各有多少项、预计耗时，请用户填完后回传。人工项 ≤ 8 个且有提问工具时，可以直接用选择题逐项询问（选项即 0–3 锚点）。收到后：
```bash
python scripts/bench.py --data bench-data ingest-scores human_scores.csv --by human
python scripts/bench.py --data bench-data ingest-usage review/usage_needed.csv
```

### 5. 汇总与导出
```bash
python scripts/bench.py --data bench-data aggregate
python scripts/bench.py --data bench-data export --formats csv,md,xlsx,png,html
```
输出在 `bench-data/exports/`：排行榜、雷达图、题目矩阵、分层得分、效率与帕累托、skill 增益、失败归因、题目分析、覆盖矩阵、运行明细、检查项明细、`benchmark.xlsx`、`report.html`。各表含义见 `references/exports.md`。

汇报给用户时：先给总榜（名次、质量分与置信区间、并列关系）、雷达图和效率图，再点出 2–3 个关键差异，最后列出评分不完整或低可信的运行。

### 6. 迭代题库
看 `item_analysis.csv`：标记为“天花板/地板/区分度低”的检查项，在下个版本中调整阈值或替换；修改 rubric 后运行 `validate-rubrics` 与 `build-spec` 重新生成规范页，并在 `config/benchmark.yaml` 升级版本号。

## 其他命令
```bash
python scripts/bench.py list                 # 列出题目与检查项数量
python scripts/bench.py validate-rubrics     # rubric 自检（id、维度、规则、锚点）
python scripts/bench.py build-spec --out benchmark-spec.html
```

## 参考文档（按需读）
- `references/scoring-model.md`：门槛、检查项层级、换算规则、N/A/缺失/待评、维度与总分公式、置信区间与并列、防天花板设计
- `references/probes.md`：每个探针测什么、依赖什么、评测接口约定、已知局限（无 GPU 时帧率只具相对意义等）
- `references/run-protocol.md`：各题运行条件、素材准备、A/C 隔离、T06 有人值守流程、提示词占位符
- `references/human-review.md`：盲评规范、锚点使用、agent 审查证据要求
- `references/time-and-cost.md`：日志解析规则、有效时间、费用估算、订阅制 harness 的处理
- `references/exports.md`：每张导出表的字段与用途
- `references/extending.md`：新增题目 / 检查项 / 探针的方法与 rubric 字段说明
