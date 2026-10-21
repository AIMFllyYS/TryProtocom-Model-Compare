# Google / gemini-3.7-flash-high — 评测报告

> Coding Bench v1.0 · 生成于 2026/10/5 02:16:41 · 由 bench-workbench 汇总 bench-grader 评分

## gemini-3.7-flash-high @ Antigravity CLI

- 名次：**1=** / 8　质量总分：**80.88**（95% CI 77.13–84.43）
- 达标率 100%　运行 18 次 / 覆盖 8 题　整套期望成本 $—　期望用时 60 分钟
- 评分完整：否（仍有待评项）　平均 N/A 占比 0%

| 维度 | 得分 |
|---|---:|
| 3D | 79.7 |
| 动画动效 | 67.2 |
| 前端 UI/UX | 62.1 |
| 后端 | 95.3 |
| 工程化 | 94.3 |
| 需求理解 | 76.2 |
| Agent 执行 | 91.4 |
| 成本效率 | — |
| 速度 | 87.8 |

### 各题

| 题目 | 运行 | 均值 | 标准差 | 最低 | 最高 | 达标率 | 期望成本 | 期望用时 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| T01 | 3 | 85.72 | 1.76 | 84.4 | 88.2 | 100% | — | 6 |
| T02 | 3 | 81.55 | 2.77 | 77.7 | 83.9 | 100% | — | 7 |
| T03A | 1 | 72.01 | 0.00 | 72.0 | 72.0 | 100% | — | — |
| T03C | 1 | 75.89 | 0.00 | 75.9 | 75.9 | 100% | — | 9 |
| T04 | 1 | 74.07 | 0.00 | 74.1 | 74.1 | 100% | — | 21 |
| T05 | 3 | 83.08 | 12.74 | 65.2 | 94.0 | 100% | — | 8 |
| T07 | 3 | 87.57 | 2.30 | 84.9 | 90.5 | 100% | — | 6 |
| T08 | 3 | 98.61 | 0.00 | 98.6 | 98.6 | 100% | — | 5 |

### 相对强项（高于全体均值最多的检查项）

- T03A T03-A06（视觉重音数量（明显的画面变化峰值））：92%，高出 58 个百分点
- T01 T01-D09（开启色调映射）：100%，高出 53 个百分点
- T07 T07-E04（自带测试通过数量）：89%，高出 45 个百分点
- T07 T07-S04（代码结构（路由/业务/存储分层，配置与常量集中））：78%，高出 27 个百分点
- T05 T05-E06（显式 any 使用次数）：98%，高出 26 个百分点

### 相对弱项

- T03A T03-A07（视觉重音落在节拍上的比例（随机约 0.3））：33%，低 50 个百分点
- T05 T05-S01（内容准确：页面与遥测数据与参数表一致，没有编造参数）：0%，低 40 个百分点
- T01 T01-A05（点击后合成音频节点数量）：13%，低 39 个百分点
- T01 T01-E09（手机宽度（390px）无横向溢出）：67%，低 28 个百分点
- T05 T05-E12（控制台零报错（桌面+手机））：67%，低 26 个百分点

## 运行明细

| 运行 id | 题目 | 次序 | harness | 总分 | 门槛 | 达标 | 待评 | 用时(分) | 费用($) | 用量来源 | 工作区 |
|---|---|---:|---|---:|---|---|---:|---:|---:|---|---|
| T01-9476b9cd | T01 | 1 | Antigravity CLI | 84.6 | 通过 | 是 | 8 | 3 | — | user | Google/gemini-3.7-flash-high/T01/r1 |
| T01-fa612425 | T01 | 2 | Antigravity CLI | 88.2 | 通过 | 是 | 8 | 5 | — | user | Google/gemini-3.7-flash-high/T01/r2 |
| T01-d2213c72 | T01 | 3 | Antigravity CLI | 84.4 | 通过 | 是 | 8 | 10 | — | user | Google/gemini-3.7-flash-high/T01/r3 |
| T02-dc9c4c3d | T02 | 1 | Antigravity CLI | 83.1 | 通过 | 是 | 9 | 7 | — | user | Google/gemini-3.7-flash-high/T02/r1 |
| T02-b5523ecc | T02 | 2 | Antigravity CLI | 77.7 | 通过 | 是 | 8 | 9 | — | user | Google/gemini-3.7-flash-high/T02/r2 |
| T02-8e8396e0 | T02 | 3 | Antigravity CLI | 83.9 | 通过 | 是 | 9 | 4 | — | user | Google/gemini-3.7-flash-high/T02/r3 |
| T03A-32e49679 | T03A | 1 | Antigravity CLI | 72.0 | 通过 | 是 | 6 | — | — | none | Google/gemini-3.7-flash-high/T03A/r1 |
| T03C-a2867e96 | T03C | 1 | Antigravity CLI | 75.9 | 通过 | 是 | 7 | 9 | — | user | Google/gemini-3.7-flash-high/T03C/r1 |
| T04-4a0e6246 | T04 | 1 | Antigravity CLI | 74.1 | 通过 | 是 | 8 | 21 | — | user | Google/gemini-3.7-flash-high/T04/r1 |
| T05-df5fa140 | T05 | 1 | Antigravity CLI | 90.1 | 通过 | 是 | 8 | 8 | — | user | Google/gemini-3.7-flash-high/T05/r1 |
| T05-4afb73a9 | T05 | 2 | Antigravity CLI | 94.0 | 通过 | 是 | 8 | 8 | — | user | Google/gemini-3.7-flash-high/T05/r2 |
| T05-729e854d | T05 | 3 | Antigravity CLI | 65.2 | 通过 | 是 | 8 | 8 | — | user | Google/gemini-3.7-flash-high/T05/r3 |
| T07-b2595347 | T07 | 1 | Antigravity CLI | 87.3 | 通过 | 是 | 0 | 5 | — | user | Google/gemini-3.7-flash-high/T07/r1 |
| T07-932ae85f | T07 | 2 | Antigravity CLI | 90.5 | 通过 | 是 | 0 | 6 | — | user | Google/gemini-3.7-flash-high/T07/r2 |
| T07-07b039fa | T07 | 3 | Antigravity CLI | 84.9 | 通过 | 是 | 0 | 6 | — | user | Google/gemini-3.7-flash-high/T07/r3 |
| T08-8f6fa3bf | T08 | 1 | Antigravity CLI | 98.6 | 通过 | 是 | 0 | 5 | — | user | Google/gemini-3.7-flash-high/T08/r1 |
| T08-4ee2238a | T08 | 2 | Antigravity CLI | 98.6 | 通过 | 是 | 0 | 4 | — | user | Google/gemini-3.7-flash-high/T08/r2 |
| T08-4fb95eb2 | T08 | 3 | Antigravity CLI | 98.6 | 通过 | 是 | 0 | 5 | — | user | Google/gemini-3.7-flash-high/T08/r3 |

## 未登记的工作区

- Google/gemini-3.7-flash-high/T06/r1（prepared） — 尚无交付目录

---
评分口径见 skills/bench-grader/references/scoring-model.md。未完成的人工/agent 项不计入分母，正式发布前应清零。
