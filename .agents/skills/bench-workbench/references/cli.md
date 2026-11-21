# wb 命令参考

所有命令在仓库根目录执行；`--json` 输出 JSON（成功时为结果对象，失败时进程以非 0 退出并在 stderr 给出原因）。服务未运行时，任何需要服务的命令都会先在后台启动它（端口 41873，可用环境变量 `WB_PORT` 覆盖）。

| 分组 | 命令 | 说明 |
| --- | --- | --- |
| 服务 | `wb status` | 版本、根目录、Python、模型/工作区/运行数、待办（未评分、人工待评、Agent 待评、缺用量、低可信） |
| | `wb start` / `wb stop` / `wb serve [--open]` | 后台启动 / 停止 / 前台运行服务 |
| | `wb open [视图]` | 打开或切换界面：overview models tasks runs stage board compare exports docs settings（旧名 spec/review/jobs/system 仍可用） |
| 题库 | `wb tasks` | 题目清单（交付目录、变体、检查项数、时限、缺失素材） |
| | `wb prompt <T05> [--for 供应商/模型] [--variant A]` | 最终发给模型的提示词（stdout）：带 `--for` 时附统一运行约定（该模型下一个工作目录的绝对路径、交付文件夹名、必须存在的文件、`FINAL_MESSAGE.md`）；警告写 stderr |
| 模型 | `wb models` | 模型清单 |
| | `wb model add <模型名 \| 供应商/模型> [--vendor X] [--harness X] [--family X] [--notes X]` | 新增/更新模型档案，建立 `model/<供应商>/<模型>/`；只写模型名时按名称自动识别供应商并推荐已安装的 harness |
| Harness | `wb harness [--refresh]` / `wb harness open <id> [--ref <ref>]` | 本机检测到的 Agent 软件；在工作目录中打开（IDE 带目录参数，命令行开新终端） |
| 交付 | `wb detect` | 未登记运行的交付清单进度、`FINAL_MESSAGE.md` 是否出现、是否已结束、预览入口 |
| AI 评审 | `wb ai-prompt [run_id\|ref]` | 给评分 Agent 的提示词：skills 路径（`.agents/skills/…`，备用绝对路径）+ `wb pending/score` 步骤 |
| Skills | `wb skills sync` | 把 `skills/` 镜像到 `.agents/skills/`（不含 `hidden/`） |
| 运行 | `wb run new <供应商>/<模型> <题号> [--variant A\|C] [--harness X]` | 为已登记模型创建 `rN/`，复制预置素材并留档提示词。陌生模型须先执行 `wb model add`。返回 `run.ref`、`workspace`、`warnings` |
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

## 离线上下文命令

```text
wb context preflight "<ref>" --json
wb context audit "<ref|run_id>" [--log "明确日志"] [--save] --json
wb context audit --all [--save] --json
wb context review "<ref|run_id>" --finding <id> --decision confirmed|dismissed --note "依据" --save --json
wb context export "<ref|run_id>" --format json|csv
wb context export --all --format json|csv
```

`context` 是 HTTP 的例外：直接执行本地 Python，不启动服务、镜像技能、同步存储或调用模型。支持 `WB_ROOT`、`WB_PYTHON`、`WB_MODEL_DIR`、`WB_BENCH_DATA`。默认只读；`--save` 只写独立 `context-audits` 目录。批量排除回收站，并在固定层级逐层检查后再枚举目录，不进入符号链接或目录联接。`--log` 可重复但仅用于单个运行。export 只导出已有报告到 stdout，不写榜单。解析/目标错误在 JSON 的 `error` 字段报告并非零退出；preflight 准备错误同样非零退出，但未知覆盖不等于准备失败。

提示词只对新创建运行增加冻结的边界前缀；prepared 旧档不重算，采用新版需显式 `wb run new`。`context_policy` 包含提示词/原生成结果/模板哈希和指定技能的发车前快照。手工粘贴的实际发送文本默认未知，剪贴板成功不等于实际发送已核验。

报告将约束版本、日志覆盖、线索类别、人工复核和发送来源分开存储，不返回“上下文干净”。`review` 只保存复核记录；过期报告须重审。独立证据不随 `bench-store.json` 自动迁移，缺失时 UI 显示证据不可用。新旧条件不完全可比，不改历史评分/AC13、榜单排序或采样规则。

`GET /api/context` 读取独立报告列表，`GET /api/context?ref=...` 或 `?run_id=...` 读取单个报告；不扫描日志、不生成报告。运行页支持约束/审计筛选和独立 JSON/CSV 导出。

## 状态字段

- 工作区运行 `status`：`prepared`（已创建）→ `running`（已开始）→ `finished`（已结束未登记）→ `registered`（已登记）→ `graded`（已评分）。
- 检查项 `status`：`scored`、`pending`（待人工/Agent）、`na`（环境原因无法检查，不计分母）、`missing`（产出缺失，计 0）。
- 排行榜名次带 `=` 表示与上一名 95% 置信区间重叠（统计上并列）；`complete=false` 表示仍有待评项。

## HTTP API

CLI 调用的是 `http://127.0.0.1:41873/api/*`：GET 为只读；POST/DELETE 需要请求头 `x-wb-token`（每次启动随机生成，写在 `workbench/.runtime/runtime.json`）。服务只监听本机并拒绝跨源请求。优先使用 CLI，而不是直接调 API。
