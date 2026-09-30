# Agent 审查项：取证与打分

Agent 项（rubric 中 `method: agent`）由执行评分的 Agent 阅读产出并按 0–3 锚点打分，用户可以在工作台复核修改。目标是**可复核**：任何人拿着你的证据都能在几分钟内确认或推翻分数。

## 步骤

1. 取清单：`wb pending --method agent --json`。按 `item_id` 分组，**同一检查项横向评完所有运行**再换下一项，避免锚点漂移。
2. 读锚点：每项的 `anchors[0..3]` 是分档描述，`evidence` 是 rubric 给出的取证依据（该看哪些文件、哪个行为）。
3. 取证：
   - 代码与文档在 `bench-data/runs/<run_id>/output/`（登记时的交付物副本）；原始工作目录在 `model/<ref>/`。
   - 需要看运行效果时用 `wb check <ref> --json`（桌面 1440×900）和 `wb check <ref> --mobile --json`，或 `wb dev <ref>` 启动开发服务器后 `wb logs <session> --errors --json`。
   - 需要看最后一条回复是否属实时读 `model/<ref>.final.md` 或 `wb show <run_id> --json`。
4. 打分：`wb score <run_id> <item_id> <0-3> --note "<证据>" --by agent`。拿不准就保持待评并在汇报里说明原因，不要取中间值。
5. 全部评完后 `wb status --json` 确认 `pending.agent` 为 0，再汇报。

## 证据格式

`--note` 用一行写清“在哪里、看到什么、对应哪一档”：

- `src/api/routes.ts:88-120 所有写接口都做了 zod 校验，但 /bookings/:id 缺少权限检查 → 2 档`
- `README.md 未说明如何运行测试；package.json 无 test 脚本 → 1 档`
- `wb check --mobile：390px 下导航溢出，控制台 TypeError: Cannot read properties of null (reading 'offsetTop') main.js:212 → 1 档`

避免：只写“良好”“有问题”；引用你没有打开过的文件；把人工项（观感、创意、手感）当作 Agent 项评分。

## 盲评

`wb pending` 同时给出 `alias`（如 R003）。向用户展示或讨论时使用别名，不要透露模型名；`run_id` 本身不含模型名，可以放心用于命令。
