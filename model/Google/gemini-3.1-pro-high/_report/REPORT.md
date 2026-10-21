# Google / gemini-3.1-pro-high — 评测报告

> Coding Bench v1.0 · 生成于 2026/10/5 07:14:16 · 由 bench-workbench 汇总 bench-grader 评分

## gemini-3.1-pro-high @ Antigravity CLI

- 名次：**8** / 8　质量总分：**61.88**（95% CI 57.28–66.39）
- 达标率 67%　运行 18 次 / 覆盖 8 题　整套期望成本 $—　期望用时 ∞ 分钟
- 评分完整：否（仍有待评项）　平均 N/A 占比 0%

| 维度 | 得分 |
|---|---:|
| 3D | 49.2 |
| 动画动效 | 43.0 |
| 前端 UI/UX | 64.7 |
| 后端 | 78.5 |
| 工程化 | 70.2 |
| 需求理解 | 57.1 |
| Agent 执行 | 70.4 |
| 成本效率 | — |
| 速度 | 77.8 |

### 各题

| 题目 | 运行 | 均值 | 标准差 | 最低 | 最高 | 达标率 | 期望成本 | 期望用时 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| T01 | 3 | 49.44 | 20.48 | 25.1 | 75.2 | 33% | — | 18 |
| T02 | 3 | 57.52 | 4.61 | 53.1 | 63.9 | 33% | — | 13 |
| T03A | 1 | 0.00 | 0.00 | 0.0 | 0.0 | 0% | — | ∞ |
| T03C | 1 | 67.72 | 0.00 | 67.7 | 67.7 | 100% | — | 3 |
| T04 | 1 | 67.95 | 0.00 | 68.0 | 68.0 | 100% | — | 6 |
| T05 | 3 | 68.11 | 20.24 | 40.0 | 86.6 | 67% | — | 8 |
| T07 | 3 | 68.52 | 1.59 | 66.8 | 70.6 | 100% | — | 4 |
| T08 | 3 | 80.36 | 2.24 | 78.8 | 83.5 | 100% | — | 4 |

### 未达标 / 失败归因

| 运行 | 题目 | 总分 | 归因 |
|---|---|---:|---|
| T01-5a393276 | T01 | 25.1 | 能力不足（未达标） |
| T01-3bd917e2 | T01 | 48.1 | 能力不足（未达标） |
| T02-33cc2be0 | T02 | 53.1 | 能力不足（未达标） |
| T02-2e8f0ac4 | T02 | 55.5 | 能力不足（未达标） |
| T03A-d0de04cf | T03A | 0.0 | 交付缺失 |
| T05-54db88e1 | T05 | 40.0 | 能力不足（未达标） |

### 相对强项（高于全体均值最多的检查项）

- T03A T03-A06（视觉重音数量（明显的画面变化峰值））：75%，高出 33 个百分点
- T04 T04-A05（双语字幕占比）：100%，高出 33 个百分点
- T03C T03-A08（场景/段落切换次数）：40%，高出 24 个百分点
- T03C T03-A04（动效密度：最长静止时长（秒））：69%，高出 22 个百分点
- T03A T03-E01（控制台零报错）：100%，高出 17 个百分点

### 相对弱项

- T08 T08-B03（B3 #37 时区问题已修复）：0%，低 83 个百分点
- T02 T02-S06（镜头表每镜头都有声音设计）：0%，低 83 个百分点
- T01 T01-D07（PBR 材质占比）：0%，低 76 个百分点
- T04 T04-E09（黑帧总时长（秒））：0%，低 70 个百分点
- T02 T02-A05（无长时间静止画面（最长静止秒数））：0%，低 64 个百分点

## 运行明细

| 运行 id | 题目 | 次序 | harness | 总分 | 门槛 | 达标 | 待评 | 用时(分) | 费用($) | 用量来源 | 工作区 |
|---|---|---:|---|---:|---|---|---:|---:|---:|---|---|
| T01-5a393276 | T01 | 1 | Antigravity CLI | 25.1 | 通过 | 否 | 8 | 6 | — | user | Google/gemini-3.1-pro-high/T01/r1 |
| T01-c4cd0139 | T01 | 2 | Antigravity CLI | 75.2 | 通过 | 是 | 8 | 5 | — | user | Google/gemini-3.1-pro-high/T01/r2 |
| T01-3bd917e2 | T01 | 3 | Antigravity CLI | 48.1 | 通过 | 否 | 8 | 6 | — | user | Google/gemini-3.1-pro-high/T01/r3 |
| T02-b4af61dc | T02 | 1 | Antigravity CLI | 63.9 | 通过 | 是 | 9 | 4 | — | user | Google/gemini-3.1-pro-high/T02/r1 |
| T02-33cc2be0 | T02 | 2 | Antigravity CLI | 53.1 | 通过 | 否 | 9 | 4 | — | user | Google/gemini-3.1-pro-high/T02/r2 |
| T02-2e8f0ac4 | T02 | 3 | Antigravity CLI | 55.5 | 通过 | 否 | 9 | 4 | — | user | Google/gemini-3.1-pro-high/T02/r3 |
| T03A-d0de04cf | T03A | 1 | Antigravity CLI | 0.0 | 未通过 | 否 | 6 | 3 | — | user | Google/gemini-3.1-pro-high/T03A/r1 |
| T03C-9ae05483 | T03C | 1 | Antigravity CLI | 67.7 | 通过 | 是 | 7 | 3 | — | user | Google/gemini-3.1-pro-high/T03C/r1 |
| T04-4a93f9b7 | T04 | 1 | Antigravity CLI | 68.0 | 通过 | 是 | 8 | 6 | — | user | Google/gemini-3.1-pro-high/T04/r1 |
| T05-4d321887 | T05 | 1 | Antigravity CLI | 77.8 | 通过 | 是 | 8 | 4 | — | user | Google/gemini-3.1-pro-high/T05/r1 |
| T05-54db88e1 | T05 | 2 | Antigravity CLI | 40.0 | 通过 | 否 | 8 | 5 | — | user | Google/gemini-3.1-pro-high/T05/r2 |
| T05-d097250c | T05 | 3 | Antigravity CLI | 86.6 | 通过 | 是 | 8 | 6 | — | user | Google/gemini-3.1-pro-high/T05/r3 |
| T07-22cdffce | T07 | 1 | Antigravity CLI | 70.6 | 通过 | 是 | 0 | 4 | — | user | Google/gemini-3.1-pro-high/T07/r1 |
| T07-71e2a312 | T07 | 2 | Antigravity CLI | 66.8 | 通过 | 是 | 0 | 3 | — | user | Google/gemini-3.1-pro-high/T07/r2 |
| T07-97d31ef1 | T07 | 3 | Antigravity CLI | 68.1 | 通过 | 是 | 0 | 4 | — | user | Google/gemini-3.1-pro-high/T07/r3 |
| T08-dfe78b10 | T08 | 1 | Antigravity CLI | 78.8 | 通过 | 是 | 0 | 4 | — | user | Google/gemini-3.1-pro-high/T08/r1 |
| T08-e0a17cba | T08 | 2 | Antigravity CLI | 83.5 | 通过 | 是 | 0 | 4 | — | user | Google/gemini-3.1-pro-high/T08/r2 |
| T08-8911b46c | T08 | 3 | Antigravity CLI | 78.8 | 通过 | 是 | 0 | 4 | — | user | Google/gemini-3.1-pro-high/T08/r3 |

## 未登记的工作区

- Google/gemini-3.1-pro-high/T06/r1（prepared） — 尚无交付目录

---
评分口径见 skills/bench-grader/references/scoring-model.md。未完成的人工/agent 项不计入分母，正式发布前应清零。
