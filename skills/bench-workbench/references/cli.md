# wb 命令参考

所有命令在仓库根目录执行；`--json` 输出 JSON（成功时为结果对象，失败时进程以非 0 退出并在 stderr 给出原因）。服务未运行时，任何需要服务的命令都会先在后台启动它（端口 41873，可用环境变量 `WB_PORT` 覆盖）。

| 分组 | 命令 | 说明 |
| --- | --- | --- |
| 服务 | `wb status` | 版本、根目录、Python、模型/工作区/运行数、待办（未评分、人工待评、Agent 待评、缺用量、低可信） |
| | `wb start` / `wb stop` / `wb serve [--open]` | 后台启动 / 停止 / 前台运行服务 |
| | `wb open [视图]` | 打开或切换界面：overview board models runs review stage spec jobs system |
| 题库 | `wb tasks` | 题目清单（交付目录、变体、检查项数、时限、缺失素材） |
| | `wb prompt <T05> [--variant A]` | 最终发给模型的提示词（stdout），警告写 stderr |
| 模型 | `wb models` | 模型清单 |
| | `wb model add <供应商>/<模型> [--harness X] [--family X] [--notes X]` | 新增/更新模型档案，建立 `model/<供应商>/<模型>/` |
| 运行 | `wb run new <供应商>/<模型> <题号> [--variant A\|C] [--harness X]` | 新建干净工作目录 `rN/`，复制预置素材，保存提示词。返回 `run.ref`、`workspace`、`warnings` |
| | `wb run list [--model 供应商/模型] [--task T05]` | 工作区运行列表（状态、计时、交付、回复、bench 运行 id、预览入口） |
| | `wb run start <ref>` | 记录开始时间 |
| | `wb run finish <ref> [--final-file f.md \| --final "…"] [--wall-min N] [--active-min N] [--cost-usd N] [--input-tokens N] [--output-tokens N] [--timed-out] [--register] [--no-grade] [--fast]` | 记录结束、保存最后回复与用量；`--register` 同时登记到 bench-grader 并（默认）评分 |
| | `wb run register <ref> [--no-grade] [--fast]` | 单独登记 |
| 评分 | `wb grade [run_id…] [--all] [--task T05] [--fast] [--skip-graded]` | 自动评分（后台任务，默认等待完成并输出） |
| | `wb review [--task T05]` | 生成 bench-grader 评分包（review/index.html、human_sheet.csv、usage_needed.csv） |
| | `wb pending [--method agent\|human] [--task T05]` | 待评项：`run_id alias task item_id method dim tier desc evidence anchors open ws_ref` |
| | `wb score <run_id> <item_id> <0-3\|clear> --note "证据" [--by agent\|human]` | 写入人工/Agent 分数，返回重算后的 `score`（总分、剩余待评） |
| | `wb show <run_id>` | 单次运行详情 |
| | `wb sync` | 从 bench-data 与 model/ 重新同步存储文件 |
| 结果 | `wb board` | 排行榜 |
| | `wb compare <关键词>…` | 参赛者对比 |
| | `wb report <供应商>/<模型>` | 单模型报告 `_report/REPORT.md` + `summary.json` |
| | `wb export [--formats csv,md,xlsx,png,html] [--label 标签]` | 全量导出到 `reports/` |
| 预览 | `wb preview <文件\|目录\|ref\|URL> [--show] [--no-inject] [--entry 相对路径]` | 创建预览会话（静态 / 本地地址走代理 / 外部地址直连），返回 `id url kind` |
| | `wb sessions` / `wb close <session>` | 会话列表 / 关闭 |
| | `wb logs <session> [--errors\|--warnings] [--since seq] [--follow]` | 页面日志：`seq ts level text url line col stack status method ms count` |
| | `wb dev <ref\|目录> [--cmd "…"] [--sub 子目录] [--show]` | 启动开发服务器，从输出识别本地地址并建立代理预览；未装依赖时先 `npm install` |
| | `wb procs` / `wb proc-log <id>` / `wb proc-stop <id>` | 进程列表 / 输出 / 停止 |
| | `wb check <文件\|ref\|URL> [--viewport WxH] [--mobile] [--wait ms] [--full]` | 无头 Chromium 检查：`loaded title counts{error,warning,failed_requests,http_errors} console[] page_errors[] failed_requests[] http_errors[] screenshot ms` |
| 任务 | `wb jobs` / `wb job <id> [--wait]` | 后台任务（串行执行） |
| | `wb doctor` / `wb materials` / `wb validate` | 依赖检查 / 生成素材 / rubric 自检 |
| 存储 | `wb store export <文件>` / `wb store import <文件>` | 导出 / 合并导入可移植存储文件 |
| 界面 | `wb ui <open\|preview\|run\|compare\|review\|spec> [key=value…]` | 遥控已打开的界面，例如 `wb ui run ref=OpenAI/GPT-6.1-Sol/T05/r1` |

## 状态字段

- 工作区运行 `status`：`prepared`（已创建）→ `running`（已开始）→ `finished`（已结束未登记）→ `registered`（已登记）→ `graded`（已评分）。
- 检查项 `status`：`scored`、`pending`（待人工/Agent）、`na`（环境原因无法检查，不计分母）、`missing`（产出缺失，计 0）。
- 排行榜名次带 `=` 表示与上一名 95% 置信区间重叠（统计上并列）；`complete=false` 表示仍有待评项。

## HTTP API

CLI 调用的是 `http://127.0.0.1:41873/api/*`：GET 为只读；POST/DELETE 需要请求头 `x-wb-token`（每次启动随机生成，写在 `workbench/.runtime/runtime.json`）。服务只监听本机并拒绝跨源请求。优先使用 CLI，而不是直接调 API。
