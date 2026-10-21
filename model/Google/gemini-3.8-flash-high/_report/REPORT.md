# Google / gemini-3.8-flash-high — 评测报告

> Coding Bench v1.0 · 生成于 2026/10/5 00:38:34 · 由 bench-workbench 汇总 bench-grader 评分

## gemini-3.8-flash-high @ Antigravity CLI

- 名次：**4=** / 8　质量总分：**78.81**（95% CI 77.02–80.63）
- 达标率 94%　运行 17 次 / 覆盖 7 题　整套期望成本 $—　期望用时 ∞ 分钟
- 评分完整：否（仍有待评项）　平均 N/A 占比 0%

| 维度 | 得分 |
|---|---:|
| 3D | 81.9 |
| 动画动效 | 47.1 |
| 前端 UI/UX | 70.0 |
| 后端 | 94.7 |
| 工程化 | 83.4 |
| 需求理解 | 81.0 |
| Agent 执行 | 93.7 |
| 成本效率 | — |
| 速度 | 72.9 |

### 各题

| 题目 | 运行 | 均值 | 标准差 | 最低 | 最高 | 达标率 | 期望成本 | 期望用时 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| T01 | 3 | 75.80 | 2.23 | 72.9 | 78.3 | 100% | — | 8 |
| T02 | 3 | 84.91 | 3.14 | 80.7 | 88.3 | 100% | — | 9 |
| T03A | 1 | 0.00 | 0.00 | 0.0 | 0.0 | 0% | — | ∞ |
| T03C | 1 | 71.80 | 0.00 | 71.8 | 71.8 | 100% | — | 13 |
| T05 | 3 | 89.90 | 2.71 | 87.2 | 93.6 | 100% | — | 10 |
| T07 | 3 | 84.72 | 4.54 | 78.3 | 88.4 | 100% | — | 6 |
| T08 | 3 | 99.07 | 0.66 | 98.6 | 100.0 | 100% | — | 7 |

### 未达标 / 失败归因

| 运行 | 题目 | 总分 | 归因 |
|---|---|---:|---|
| T03A-0c88dc70 | T03A | 0.0 | 交付缺失 |

### 相对强项（高于全体均值最多的检查项）

- T02 T02-A05（无长时间静止画面（最长静止秒数））：100%，高出 36 个百分点
- T03C T03-A09（文字碰撞帧比例（运动途中文字互相遮挡））：100%，高出 36 个百分点
- T03C T03-A06（视觉重音数量（明显的画面变化峰值））：67%，高出 33 个百分点
- T05 T05-H04（视觉设计与信息层级（首屏主张、区块节奏、留白））：67%，高出 33 个百分点
- T02 T02-S13（QC 报告记录了真实发现的问题与修复（问题表行数））：100%，高出 32 个百分点

### 相对弱项

- T01 T01-D09（开启色调映射）：0%，低 47 个百分点
- T01 T01-A02（2.5D 独立运动部件数（0.5 秒内属性变化的元素））：16%，低 45 个百分点
- T01 T01-A05（点击后合成音频节点数量）：9%，低 43 个百分点
- T05 T05-S01（内容准确：页面与遥测数据与参数表一致，没有编造参数）：0%，低 40 个百分点
- T03A T03-A08（场景/段落切换次数）：0%，低 33 个百分点

## 运行明细

| 运行 id | 题目 | 次序 | harness | 总分 | 门槛 | 达标 | 待评 | 用时(分) | 费用($) | 用量来源 | 工作区 |
|---|---|---:|---|---:|---|---|---:|---:|---:|---|---|
| T01-b48e8f12 | T01 | 2 | Antigravity CLI | 72.9 | 通过 | 是 | 2 | 7 | — | user | Google/gemini-3.8-flash-high/T01/r2 |
| T01-4ade31ab | T01 | 3 | Antigravity CLI | 78.3 | 通过 | 是 | 2 | 9 | — | user | Google/gemini-3.8-flash-high/T01/r3 |
| T01-b32bf40c | T01 | 4 | Antigravity CLI | 76.2 | 通过 | 是 | 8 | 7 | — | user | Google/gemini-3.8-flash-high/T01/r4 |
| T02-a22dbd74 | T02 | 1 | Antigravity CLI | 88.3 | 通过 | 是 | 9 | 11 | — | user | Google/gemini-3.8-flash-high/T02/r1 |
| T02-765be3e1 | T02 | 2 | Antigravity CLI | 80.7 | 通过 | 是 | 9 | 9 | — | user | Google/gemini-3.8-flash-high/T02/r2 |
| T02-2fa7bc8c | T02 | 3 | Antigravity CLI | 85.7 | 通过 | 是 | 9 | 8 | — | user | Google/gemini-3.8-flash-high/T02/r3 |
| T03A-0c88dc70 | T03A | 4 | Antigravity CLI | 0.0 | 未通过 | 否 | 6 | 15 | — | user | Google/gemini-3.8-flash-high/T03A/r4 |
| T03C-ff185888 | T03C | 2 | Antigravity CLI | 71.8 | 通过 | 是 | 7 | 13 | — | user | Google/gemini-3.8-flash-high/T03C/r2 |
| T05-ed7082df | T05 | 1 | Antigravity CLI | 87.2 | 通过 | 是 | 6 | 12 | — | user | Google/gemini-3.8-flash-high/T05/r1 |
| T05-a9f65980 | T05 | 2 | Antigravity CLI | 88.9 | 通过 | 是 | 8 | 7 | — | user | Google/gemini-3.8-flash-high/T05/r2 |
| T05-8c1d1325 | T05 | 3 | Antigravity CLI | 93.6 | 通过 | 是 | 8 | 10 | — | user | Google/gemini-3.8-flash-high/T05/r3 |
| T07-5e59a425 | T07 | 2 | Antigravity CLI | 78.3 | 通过 | 是 | 0 | 8 | — | user | Google/gemini-3.8-flash-high/T07/r2 |
| T07-ae5b01ce | T07 | 3 | Antigravity CLI | 87.4 | 通过 | 是 | 0 | 5 | — | user | Google/gemini-3.8-flash-high/T07/r3 |
| T07-abd19bb4 | T07 | 4 | Antigravity CLI | 88.4 | 通过 | 是 | 0 | 7 | — | user | Google/gemini-3.8-flash-high/T07/r4 |
| T08-65d113cd | T08 | 2 | Antigravity CLI | 100.0 | 通过 | 是 | 0 | 7 | — | user | Google/gemini-3.8-flash-high/T08/r2 |
| T08-e1ca8240 | T08 | 3 | Antigravity CLI | 98.6 | 通过 | 是 | 0 | 6 | — | user | Google/gemini-3.8-flash-high/T08/r3 |
| T08-53d069e3 | T08 | 4 | Antigravity CLI | 98.6 | 通过 | 是 | 0 | 7 | — | user | Google/gemini-3.8-flash-high/T08/r4 |

## 未登记的工作区

- Google/gemini-3.8-flash-high/T04/r1（finished）
- Google/gemini-3.8-flash-high/T06/r1（prepared） — 尚无交付目录

---
评分口径见 skills/bench-grader/references/scoring-model.md。未完成的人工/agent 项不计入分母，正式发布前应清零。
