# 导出表格

`export --formats csv,md,xlsx,png,html`。CSV 为 UTF-8 BOM（Excel 直接打开），xlsx 每张表一个工作表并附“图表”页。

| 文件 | 字段 | 用途 |
|---|---|---|
| leaderboard.csv / .md | 名次（并列带“=”）、参赛者、质量总分、95% 置信区间、9 维得分、达标率、整套期望成本/用时、运行次数、评分完整、N/A 占比 | 主榜 |
| radar.csv / radar.png / radar_NN.png | 参赛者 × 9 维 | 雷达图（全部叠加 + 每人一张；无数据维度按 0 绘制并在图下注明） |
| task_matrix.csv | 参赛者 × 题目：均值 ± 标准差 | 单题对比 |
| tasks.csv | 运行次数、均值、标准差、最低、最高、达标率、pass@k、门槛失败次数、评分完整、低可信 | 稳定性 |
| task_dims.csv | 参赛者 × 题目 × 维度 | 追溯维度分来源 |
| tiers.csv | 基础/进阶/卓越/扣分项得分率 | 基础项都满分时看差距在哪层 |
| efficiency.csv / pareto.png | 单次费用、单次用时、达标率、期望成功成本、期望达标用时、成本效率分、速度分；帕累托前沿 | 性价比 |
| task_scores.png | 题目得分柱状图（含误差线） | 快速浏览 |
| skill_uplift.csv | T03 A/C 两组均分、动画分、费用、用时及差值 | skill 增益 |
| failures.csv | 未达标运行及归因（谎报完成 / 无法运行 / 交付缺失 / 超时 / 能力不足） | 区分模型问题与环境问题 |
| item_analysis.csv | 每个检查项的平均分、参赛者间标准差、参赛者内标准差、样本数、标记（天花板/地板/区分度低） | 迭代题库 |
| coverage.csv | 题目 × 维度权重与检查项数 | 覆盖是否均衡 |
| runs.csv | 每次运行的总分、门槛、维度分、用时、token、费用、来源 | 审计 |
| item_scores_long.csv | 运行 × 检查项的原始值、状态、得分 | 二次分析 |
| benchmark.xlsx | 以上全部 | 分享 |
| report.html | 单页报告（内嵌图表） | 分享 |
