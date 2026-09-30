# 用时与成本

## 来源优先级
1. **用户登记值**：`meta.json` 的 `usage` 字段（`init-run --extra` 或 `ingest-usage` 写入）。
2. **本地 harness 日志**：按运行的 `workspace`（工作目录）与 `started_at`/`ended_at` 时间窗口匹配会话；也可在 `--extra` 中给 `log_path` 直接指定文件或目录。
3. **仍缺失** → 写入 `review/usage_needed.csv`，与人工评分一起一次性请用户补。

会话连接了用户电脑时，日志在用户电脑上：先读取对应目录（或把相关会话文件暂存到工作区），再解析；不要在云端工作区里找用户电脑上的路径。

## 日志解析
| harness | 默认位置 | 匹配 | 统计 |
|---|---|---|---|
| Claude Code | `~/.claude/projects/<项目>/<会话>.jsonl` | 条目 `cwd` 与工作目录一致 | assistant 消息的 usage（按 message.id 去重）：input、output、cache_read、cache_creation；时间戳 |
| Codex CLI | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | `session_meta.payload.cwd` | 最后一个 `token_count.total_token_usage`；input 中扣除 cached 部分；reasoning 单列 |
| Gemini CLI | `~/.gemini/tmp/**` | JSON 中的 cwd/projectRoot | tokens / usageMetadata（尽力解析） |

日志格式可能随版本变化；解析失败时不要猜数，走第 3 步。

## 时间口径
- **墙钟时间**：会话首尾时间戳之差。
- **有效时间**：墙钟时间减去“等待人回复”的间隔（下一条是人类消息而非工具结果时，前面的间隔视为等待）。T06 等有人值守题目用有效时间更公平。
- 效率维度使用有效时间；没有有效时间时退回墙钟时间。

## 费用
- 费用 = 未缓存输入 × input 单价 + 输出 × output 单价 + 缓存读取 × cache_read 单价 + 缓存写入 × cache_write 单价（均为每百万 token）。
- 单价来自 `config/prices.yaml`，按模型名子串匹配（最长匹配优先）；请用户按官方价格页填写并注明 `as_of`。
- 订阅制 harness 也按 API 等价价格估算，报告中 `cost_estimated = 是`。
- 模型名不在单价表中：只记录 token，费用列入待补。
