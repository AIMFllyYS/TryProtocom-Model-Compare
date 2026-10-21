# Anthropic / Claude-Haiku-5.5 — 评测报告

> Coding Bench v1.0 · 生成于 2026/10/9 02:30:55 · 由 bench-workbench 汇总 bench-grader 评分

## Claude-Haiku-5.5 @ Claude Web Chat + local command relay

- 名次：**1=** / 9　质量总分：**87.82**（95% CI 87.82–87.82）
- 达标率 100%　运行 9 次 / 覆盖 9 题　整套期望成本 $—　期望用时 258 分钟
- 评分完整：否（仍有待评项）　平均 N/A 占比 1%

| 维度 | 得分 |
|---|---:|
| 3D | 89.8 |
| 动画动效 | 65.1 |
| 前端 UI/UX | 95.8 |
| 后端 | 99.6 |
| 工程化 | 98.3 |
| 需求理解 | 66.7 |
| Agent 执行 | 99.4 |
| 成本效率 | — |
| 速度 | 57.0 |

### 各题

| 题目 | 运行 | 均值 | 标准差 | 最低 | 最高 | 达标率 | 期望成本 | 期望用时 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| T01 | 1 | 92.70 | 0.00 | 92.7 | 92.7 | 100% | — | 58 |
| T02 | 1 | 87.84 | 0.00 | 87.8 | 87.8 | 100% | — | 46 |
| T03A | 1 | 78.44 | 0.00 | 78.4 | 78.4 | 100% | — | 14 |
| T03C | 1 | 79.68 | 0.00 | 79.7 | 79.7 | 100% | — | 55 |
| T04 | 1 | 72.27 | 0.00 | 72.3 | 72.3 | 100% | — | 26 |
| T05 | 1 | 95.50 | 0.00 | 95.5 | 95.5 | 100% | — | 20 |
| T06 | 1 | 73.58 | 0.00 | 73.6 | 73.6 | 100% | — | 16 |
| T07 | 1 | 97.56 | 0.00 | 97.6 | 97.6 | 100% | — | 10 |
| T08 | 1 | 100.00 | 0.00 | 100.0 | 100.0 | 100% | — | 12 |

### 相对强项（高于全体均值最多的检查项）

- T02 T02-D03（使用 InstancedMesh 等批量绘制方块）：100%，高出 79 个百分点
- T06 T06-R06（每日上限与真实意图一致（4 小时））：100%，高出 67 个百分点
- T05 T05-S01（内容准确：页面与遥测数据与参数表一致，没有编造参数）：100%，高出 57 个百分点
- T05 T05-U03（滚动叙事：5 个区块镜头画面各不相同）：100%，高出 56 个百分点
- T07 T07-R02（DECISIONS.md 提到“封禁期间已有预约如何处理”（关键词辅助））：100%，高出 55 个百分点

### 相对弱项

- T05 T05-D04（开启色调映射）：0%，低 90 个百分点
- T04 T04-A05（双语字幕占比）：0%，低 57 个百分点
- T02 T02-A04（角色确实在动（姿态变化次数））：20%，低 55 个百分点
- T01 T01-D09（开启色调映射）：0%，低 45 个百分点
- T02 T02-A03（定格节奏：姿态每 2–3 帧才变化一次（保持比例））：41%，低 29 个百分点

## 运行明细

| 运行 id | 题目 | 次序 | harness | 总分 | 门槛 | 达标 | 待评 | 用时(分) | 费用($) | 用量来源 | 工作区 |
|---|---|---:|---|---:|---|---|---:|---:|---:|---|---|
| T01-c394e6cb | T01 | 2 | Claude Web Chat + local command relay | 92.7 | 通过 | 是 | 8 | 58 | — | user | Anthropic/Claude-Haiku-5.5/T01/r2 |
| T02-b9601e0b | T02 | 1 | Claude Web Chat + local command relay | 87.8 | 通过 | 是 | 9 | 46 | — | user | Anthropic/Claude-Haiku-5.5/T02/r1 |
| T03A-49a2cf78 | T03A | 1 | Claude Web Chat + local command relay | 78.4 | 通过 | 是 | 6 | 14 | — | user | Anthropic/Claude-Haiku-5.5/T03A/r1 |
| T03C-627cb29e | T03C | 1 | Claude Web Chat + local command relay | 79.7 | 通过 | 是 | 6 | 55 | — | user | Anthropic/Claude-Haiku-5.5/T03C/r1 |
| T04-0e597d65 | T04 | 1 | Claude Web Chat + local command relay | 72.3 | 通过 | 是 | 5 | 26 | — | user | Anthropic/Claude-Haiku-5.5/T04/r1 |
| T05-fed7d27a | T05 | 1 | Claude Web Chat + local command relay | 95.5 | 通过 | 是 | 8 | 20 | — | user | Anthropic/Claude-Haiku-5.5/T05/r1 |
| T06-87f14233 | T06 | 1 | Claude Web Chat + local command relay | 73.6 | 通过 | 是 | 5 | 16 | — | user | Anthropic/Claude-Haiku-5.5/T06/r1 |
| T07-7cf02fff | T07 | 1 | Claude Web Chat + local command relay | 97.6 | 通过 | 是 | 0 | 10 | — | user | Anthropic/Claude-Haiku-5.5/T07/r1 |
| T08-204c58a1 | T08 | 1 | Claude Web Chat + local command relay | 100.0 | 通过 | 是 | 0 | 12 | — | user | Anthropic/Claude-Haiku-5.5/T08/r1 |

---
评分口径见 skills/bench-grader/references/scoring-model.md。未完成的人工/agent 项不计入分母，正式发布前应清零。
