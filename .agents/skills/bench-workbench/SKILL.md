---
name: bench-workbench
description: 用 Bench Workbench 的本地 CLI（wb）在 Agent 软件里完成整套模型评测：新建模型与干净工作区（model/<供应商>/<模型>/<题号>/rN/）、下发提示词、计时、登记到 bench-grader、自动评分、Agent 审查项打分（附证据）、无头加载页面读取 F12 报错与截图、启动模型的开发服务器预览、出榜对比与导出报告。触发词：评测工作台、wb、跑 benchmark、新建运行、登记运行、Agent 审查打分、检查页面报错、预览模型产物、模型对比、导出榜单。与 bench-grader 配合使用。
---

# bench-workbench

Bench Workbench 是本仓库的本地评测工作台（网页 `http://127.0.0.1:41873`，桌面版 Electron）。它把 **bench-grader**（评分口径、探针、导出）和 **模型工作区**、**可移植存储文件**、**预览舞台** 串成一条流水线，并通过 `wb` CLI 暴露给 Agent。界面、CLI 与 Agent 读写的是同一份服务端状态。

- 评分规则、检查项、锚点：以 `skills/bench-grader/`（`tasks/*/rubric.yaml`）为准；先读 `skills/bench-grader/SKILL.md` 的“不可违反的规则”。
- 本 skill 只描述**怎么用 wb 操作**；命令全表见 `references/cli.md`。

## 不可违反的规则

1. **隐藏材料不外泄**：`skills/bench-grader/tasks/*/hidden/` 永远不能出现在被测模型的工作目录、提示词或对话里。`wb run new` 只复制 `materials/`，不要手动复制其他东西进 `rN/`。
2. **不伪造分数**：人工项（`method=human`）只能来自用户；你只能给 **Agent 项**（`method=agent`）打分，且每一条都必须附证据（`--note "文件:行号 / 可复现现象"`）。看不到证据就保持待评。
3. **被测与评测分离**：如果你本身就是被测模型，不要给自己打分，也不要读取 `hidden/`；只做被要求的那道题。
4. **集中询问**：需要用户提供的东西（人工评分、缺失的用时/费用、T06 的值守回答）攒到一次问。
5. **如实汇报**：区分“自动评分完成 / 待人工 / 待 Agent / N/A / 低可信 / 评分不完整”。

## 准备

在仓库根目录执行（Windows 用 `wb.cmd` 或直接 `wb`；macOS/Linux 用 `./wb`）：

```bash
wb status          # 服务未启动会自动后台启动；显示模型数、运行数、待办
wb tasks           # 题库：题号、交付目录、变体、检查项数、时限、缺失素材
```

所有命令加 `--json` 输出机器可读结果，**Agent 应始终使用 `--json` 解析**。第一次在一台评测机上使用时运行 `wb doctor`（依赖检查）与 `wb materials`（生成 T03/T04 统一素材）。

## 目录约定

```
model/<供应商>/<模型>/                  模型目录（名称允许点与短横，例如 OpenAI/GPT-6.1-Sol）
  model.json                            模型档案
  <题号[变体]>/rN/                      第 N 次运行的干净工作目录（被测 Agent 只在这里工作；独立 git 根，看不到评分 skill）
  <题号[变体]>/rN/FINAL_MESSAGE.md      被测模型按运行约定写出的最后回复（工作台自动导入并结束计时）
  <题号[变体]>/rN.run.json              运行登记：harness、计时、用量、bench-grader 运行 id
  <题号[变体]>/rN.prompt.md             当次发给模型的提示词留档
  <题号[变体]>/rN.final.md              模型最后一条回复
  _report/REPORT.md                     单模型报告（wb report 生成）
data/bench-store.json                   可移植存储文件：复制到别的电脑即可恢复全部对比数据
.agents/skills/                         bench-workbench 与 bench-grader 的镜像（服务启动时从 skills/ 同步，不含 hidden/）
bench-data/                             bench-grader 工作数据（运行副本、metrics、score）
reports/<时间>-<标签>/                  全局导出（CSV/MD/XLSX/PNG/HTML + 存储快照）
```

ref（工作区引用）格式：`供应商/模型/题号[变体]/rN`，例如 `OpenAI/GPT-6.1-Sol/T03A/r2`。

## 标准流程

### 1. 模型与运行
```bash
wb model add GPT-6.1-Sol                                        # 只写名称：自动识别供应商 → model/OpenAI/GPT-6.1-Sol/，推荐本机已安装的 harness
wb model add OpenAI/GPT-6.1-Sol --harness "DeepSeek Harness"    # 或显式指定
wb prompt T05 --for OpenAI/GPT-6.1-Sol                          # 最终提示词：统一「运行约定」头（工作目录绝对路径、交付文件夹名、必须存在的文件）+ 题目原文
wb run new OpenAI/GPT-6.1-Sol T05                               # 创建干净工作目录 rN/（复制预置素材、git init 隔离），T03 需 --variant A|C
```
工作台界面里对应的是「题目」页的「复制提示词」：一次点击 = 创建（或复用未开始的）工作目录 + 复制提示词 + 开始计时，可选同时打开 harness。
每个“模型 @ harness”每题跑规范要求的次数（默认 3 次），每次都新建运行。

### 2. 交付检测与完成
- 统一运行约定要求被测模型完成后把最后回复原文写入工作目录下的 `FINAL_MESSAGE.md`。工作台每 3 秒扫描：按交付清单逐项检查文件，`FINAL_MESSAGE.md` 出现即导入为最后回复并以文件时间结束计时。
```bash
wb detect                                                       # 各运行的交付进度 / FINAL_MESSAGE / 是否结束
wb run finish <ref> --register                                  # 登记到 bench-grader 并（默认）自动评分；最后回复已自动导入时无需 --final-file
#   可带用量：--wall-min 32 --active-min 25 --cost-usd 1.8 --input-tokens … --output-tokens …；超时加 --timed-out
```
- 用时/费用未知时可以不填：bench-grader 会尝试解析本地 harness 日志；仍缺失的会出现在 `wb status` 的“缺用量”。
- 交付目录必须存在于 `rN/<交付目录>/`，否则登记失败。

### 3. 自动评分
```bash
wb grade --skip-graded            # 评分所有未评分运行（串行任务，--fast 跳过评审视频渲染）
wb jobs / wb job <id> --wait      # 查看任务
wb show <run_id> --json           # 单次运行：总分、门槛、维度、逐项得分、探针备注
```
探针崩溃按“缺失”计 0 分：先判断是否评测环境问题（缺 ffmpeg/Chromium/npm），环境问题应修环境后重评，而不是接受 0 分。

### 4. Agent 审查项
用户通常会把工作台生成的「AI 评审提示词」（`wb ai-prompt [run_id|ref]`）粘贴给你，里面写明了要处理的运行与下面的步骤。
```bash
wb pending --method agent --json                                 # 待评 Agent 项：run_id、item_id、描述、依据、0–3 锚点、产出目录
wb score <run_id> <item_id> <0-3> --note "src/app.ts:42 …" --by agent
```
逐项阅读产出目录（`bench-data/runs/<run_id>/output/`）中的代码与文档，对照锚点给分。详细做法与证据格式见 `references/agent-review.md`。人工项（`--method human`）交给用户在工作台“评审”页盲评，或整理成一次性清单请用户给分。

### 5. 看页面效果与报错（F12）
```bash
wb check <ref|文件|URL> --json                                   # 无头 Chromium：console 错误/警告、页面异常、失败请求、HTTP≥400、截图路径
wb check <ref> --mobile --viewport 390x844 --json                # 移动端
wb preview <ref> --show                                          # 在工作台预览舞台打开（注入控制台探针）
wb logs <session> --errors --json [--follow]                     # 读取预览中页面的实时报错
wb dev <ref> [--cmd "npm run dev"] [--sub 子目录] --show         # 启动模型的开发服务器，自动接入代理预览（含 HMR）
wb procs / wb proc-log <id> / wb proc-stop <id>
```
这些输出可作为 Agent 项的证据（例如“移动端 390px 下控制台 3 个 TypeError，见截图”）。用完 `wb proc-stop` 停掉开发服务器，`wb close <session>` 关闭预览。

### 6. 结果
```bash
wb board --json                    # 排行榜：质量总分、95% CI、9 维、达标率、期望成本/用时、是否完整
wb compare GPT Claude --json       # 按关键词对比参赛者：维度 + 逐题均值±标准差
wb report OpenAI/GPT-6.1-Sol       # 写入 model/OpenAI/GPT-6.1-Sol/_report/REPORT.md
wb export                          # bench-grader 全量导出到 reports/<时间>-leaderboard/
wb ui compare entrants="GPT-6.1-Sol @ Codex CLI,…"               # 让打开的界面跳到对比页
```

### 7. 换电脑
```bash
wb store export bench-store.json   # 或直接复制 data/bench-store.json
wb store import bench-store.json   # 在另一台电脑合并（按运行 id，较新的覆盖）
```
存储文件包含模型档案、登记运行的分数与逐项结果、人工评分、用量、笔记，因此只拿到这个文件也能出榜与对比；产物预览需要对应的 `model/` 或 `bench-data/` 文件。

## 汇报模板

向用户汇报时给出：完成了哪些 ref（及 run_id）、自动评分结果（总分、门槛是否通过）、Agent 项打了哪些分及证据摘要、仍待人工的项数、缺失的用量、任何环境问题导致的 N/A，以及工作台里可以直接查看的位置（例如“运行 → OpenAI/GPT-6.1-Sol/T05/r1”）。

## 参考

- `references/cli.md` —— wb 命令全表、参数与 JSON 字段
- `references/agent-review.md` —— Agent 审查项的取证方法与证据格式
- `skills/bench-grader/references/run-protocol.md` —— 运行协议（提示词使用、A/C 组、T06 值守）
- `skills/bench-grader/references/human-review.md` —— 人工评分收集方式
