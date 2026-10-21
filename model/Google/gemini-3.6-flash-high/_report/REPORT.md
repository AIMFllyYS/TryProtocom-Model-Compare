# Google / gemini-3.6-flash-high — 评测报告

> Coding Bench v1.0 · 生成于 2026/10/5 05:57:36 · 由 bench-workbench 汇总 bench-grader 评分

## gemini-3.6-flash-high @ Antigravity CLI

- 名次：**6=** / 8　质量总分：**74.99**（95% CI 73.50–76.62）
- 达标率 94%　运行 17 次 / 覆盖 7 题　整套期望成本 $—　期望用时 ∞ 分钟
- 评分完整：否（仍有待评项）　平均 N/A 占比 0%

| 维度 | 得分 |
|---|---:|
| 3D | 78.8 |
| 动画动效 | 47.2 |
| 前端 UI/UX | 61.2 |
| 后端 | 95.3 |
| 工程化 | 79.3 |
| 需求理解 | 76.2 |
| Agent 执行 | 87.0 |
| 成本效率 | — |
| 速度 | 82.8 |

### 各题

| 题目 | 运行 | 均值 | 标准差 | 最低 | 最高 | 达标率 | 期望成本 | 期望用时 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| T01 | 3 | 81.15 | 1.25 | 80.2 | 82.9 | 100% | — | 3 |
| T02 | 3 | 75.76 | 3.15 | 71.4 | 78.7 | 100% | — | 5 |
| T03A | 1 | 0.00 | 0.00 | 0.0 | 0.0 | 0% | — | ∞ |
| T03C | 1 | 71.01 | 0.00 | 71.0 | 71.0 | 100% | — | 8 |
| T05 | 3 | 84.06 | 4.64 | 77.6 | 88.2 | 100% | — | 6 |
| T07 | 3 | 82.80 | 4.38 | 76.6 | 86.2 | 100% | — | 5 |
| T08 | 3 | 96.69 | 0.94 | 96.0 | 98.0 | 100% | — | 4 |

### 未达标 / 失败归因

| 运行 | 题目 | 总分 | 归因 |
|---|---|---:|---|
| T03A-268cad78 | T03A | 0.0 | 交付缺失 |

### 相对强项（高于全体均值最多的检查项）

- T01 T01-A05（点击后合成音频节点数量）：100%，高出 48 个百分点
- T02 T02-D02（场景规模（网格数））：84%，高出 33 个百分点
- T03C T03-A07（视觉重音落在节拍上的比例（随机约 0.3））：100%，高出 22 个百分点
- T03A T03-A09（文字碰撞帧比例（运动途中文字互相遮挡））：100%，高出 20 个百分点
- T05 T05-D02（PBR 材质占比）：80%，高出 19 个百分点

### 相对弱项

- T01 T01-D09（开启色调映射）：0%，低 47 个百分点
- T03A T03-A07（视觉重音落在节拍上的比例（随机约 0.3））：29%，低 44 个百分点
- T03C T03-A04（动效密度：最长静止时长（秒））：0%，低 41 个百分点
- T01 T01-D02（建模细节：网格数量）：26%，低 41 个百分点
- T05 T05-U03（滚动叙事：5 个区块镜头画面各不相同）：0%，低 41 个百分点

## 运行明细

| 运行 id | 题目 | 次序 | harness | 总分 | 门槛 | 达标 | 待评 | 用时(分) | 费用($) | 用量来源 | 工作区 |
|---|---|---:|---|---:|---|---|---:|---:|---:|---|---|
| T01-f15d375b | T01 | 1 | Antigravity CLI | 80.4 | 通过 | 是 | 8 | 4 | — | user | Google/gemini-3.6-flash-high/T01/r1 |
| T01-dd4d406a | T01 | 2 | Antigravity CLI | 80.2 | 通过 | 是 | 8 | 3 | — | user | Google/gemini-3.6-flash-high/T01/r2 |
| T01-8f3b0b76 | T01 | 3 | Antigravity CLI | 82.9 | 通过 | 是 | 8 | 2 | — | user | Google/gemini-3.6-flash-high/T01/r3 |
| T02-1b202b0f | T02 | 1 | Antigravity CLI | 77.2 | 通过 | 是 | 8 | 4 | — | user | Google/gemini-3.6-flash-high/T02/r1 |
| T02-3bd5bdc8 | T02 | 2 | Antigravity CLI | 71.4 | 通过 | 是 | 8 | 5 | — | user | Google/gemini-3.6-flash-high/T02/r2 |
| T02-16c749b8 | T02 | 3 | Antigravity CLI | 78.7 | 通过 | 是 | 8 | 4 | — | user | Google/gemini-3.6-flash-high/T02/r3 |
| T03A-268cad78 | T03A | 3 | Antigravity CLI | 0.0 | 未通过 | 否 | 6 | 8 | — | user | Google/gemini-3.6-flash-high/T03A/r3 |
| T03C-33d1da14 | T03C | 1 | Antigravity CLI | 71.0 | 通过 | 是 | 7 | 8 | — | user | Google/gemini-3.6-flash-high/T03C/r1 |
| T05-01a342f3 | T05 | 1 | Antigravity CLI | 86.4 | 通过 | 是 | 8 | 7 | — | user | Google/gemini-3.6-flash-high/T05/r1 |
| T05-2b181fc4 | T05 | 2 | Antigravity CLI | 77.6 | 通过 | 是 | 8 | 7 | — | user | Google/gemini-3.6-flash-high/T05/r2 |
| T05-2bd7ec94 | T05 | 3 | Antigravity CLI | 88.2 | 通过 | 是 | 8 | 5 | — | user | Google/gemini-3.6-flash-high/T05/r3 |
| T07-81800cd2 | T07 | 1 | Antigravity CLI | 85.5 | 通过 | 是 | 0 | 8 | — | user | Google/gemini-3.6-flash-high/T07/r1 |
| T07-293782db | T07 | 2 | Antigravity CLI | 86.2 | 通过 | 是 | 0 | 5 | — | user | Google/gemini-3.6-flash-high/T07/r2 |
| T07-e3a51db9 | T07 | 3 | Antigravity CLI | 76.6 | 通过 | 是 | 0 | 3 | — | user | Google/gemini-3.6-flash-high/T07/r3 |
| T08-2459ec18 | T08 | 1 | Antigravity CLI | 98.0 | 通过 | 是 | 0 | 6 | — | user | Google/gemini-3.6-flash-high/T08/r1 |
| T08-26af9e71 | T08 | 2 | Antigravity CLI | 96.0 | 通过 | 是 | 0 | 3 | — | user | Google/gemini-3.6-flash-high/T08/r2 |
| T08-f32ed684 | T08 | 3 | Antigravity CLI | 96.0 | 通过 | 是 | 0 | 4 | — | user | Google/gemini-3.6-flash-high/T08/r3 |

## 未登记的工作区

- Google/gemini-3.6-flash-high/T04/r1（finished）
- Google/gemini-3.6-flash-high/T06/r1（prepared） — 尚无交付目录

---
评分口径见 skills/bench-grader/references/scoring-model.md。未完成的人工/agent 项不计入分母，正式发布前应清零。
