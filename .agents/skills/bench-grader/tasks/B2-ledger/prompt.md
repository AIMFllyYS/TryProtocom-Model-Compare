# 任务：账务与转账服务

## 契约

- 技术栈自选（Node.js / Python / Go 等均可），要能在装有 Node 22 与 Python 3.11 的 Linux 机器上用一条命令启动。可以使用开源依赖，但要有锁文件或固定版本。
- 在工作目录新建文件夹 `ledger/`，所有交付都放在里面。
- 监听端口取环境变量 `PORT`；数据文件路径取环境变量 `DB_PATH`；`GET /health` 返回 200。
- **数据必须持久化，并且在响应之前就已经落盘**：评测会在服务处理请求的过程中直接 `kill -9`，然后用同一个 `DB_PATH` 重启，已经返回 2xx 的操作必须都还在。
- 环境变量 `BENCH_MODE=1` 时提供 `POST /api/__bench/reset`：清空账户、流水和幂等记录，回到初始状态，返回 200 或 204。
- 在 `ledger/bench.json` 写：`{"start": "启动命令", "setup": "安装依赖命令（可空）", "test": "运行你自己测试的命令", "health": "/health"}`。
- 你自己的测试要能对一个正在运行的服务实例工作：读取环境变量 `BASE_URL`（例如 `http://127.0.0.1:8080`）发请求，不要在测试里自己再起一个服务。评测会把你的测试对着“故意改错的实现”跑，看它能不能发现错误。
- `README.md`（启动、接口、配置）与 `DECISIONS.md`（规格里没有说清楚的地方，你怎么处理、为什么）。
- 完成时在工作目录写 `FINAL_MESSAGE.md`：交付了什么、怎么验证的、已知限制。只写真实存在的内容。

## 规格

一个内部记账系统需要一个小而可靠的账务服务。金额一律是整数“分”（`amount_cents`），合法范围 1 ~ 1,000,000,000；账户余额永远不能为负。

### 接口（JSON，前缀 `/api`）

| 方法 | 路径 | 说明 | 成功状态 |
|---|---|---|---|
| POST | `/accounts` | `{owner}`（1–40 字的字符串）→ `{id, owner, balance_cents: 0}` | 201 |
| GET | `/accounts/{id}` | → `{id, owner, balance_cents}` | 200 |
| POST | `/accounts/{id}/deposits` | `{amount_cents}` → `{id, type: "deposit", account, amount_cents, balance_cents}`（入账后的余额） | 201 |
| POST | `/transfers` | `{from, to, amount_cents, memo?}`（memo 是不超过 100 字的字符串）→ 转账对象 | 201 |
| GET | `/transfers/{id}` | → 转账对象（也包括冲正记录；入账记录不在此返回，404） | 200 |
| POST | `/transfers/{id}/reverse` | 冲正一笔转账 → 冲正对象 | 201 |
| GET | `/accounts/{id}/entries?limit=&after=` | 该账户的流水分页 | 200 |
| GET | `/bank/summary` | → `{total_cents, deposits_cents, accounts}`：全部账户余额之和、累计入账金额、账户数 | 200 |

转账对象：`{id, type: "transfer", from, to, amount_cents, memo, status}`，`status` 为 `posted` 或 `reversed`。冲正对象：`{id, type: "reversal", of: <原转账 id>, from, to, amount_cents, status: "posted"}`，其中 `from` / `to` 与原转账相反。

### 业务规则

1. **转账**：从 `from` 账户扣款、向 `to` 账户加款，两件事要么都发生要么都不发生。`from` 等于 `to`：422 `SAME_ACCOUNT`；余额不足：422 `INSUFFICIENT_FUNDS`（余额恰好等于金额是允许的）；账户不存在：404 `NOT_FOUND`。
2. **冲正**：把一笔 `posted` 的转账原路退回（`to` 账户扣款、`from` 账户加款）。成功后原转账 `status` 变为 `reversed`。已冲正过：409 `ALREADY_REVERSED`；对冲正记录再冲正：422 `NOT_REVERSIBLE`；`to` 账户余额不足以退回：422 `INSUFFICIENT_FUNDS`（此时原转账保持 `posted`）；转账不存在：404 `NOT_FOUND`。同一笔转账并发冲正，只能成功一次。
3. **幂等**：入账、转账、冲正这三个 POST **必须**带请求头 `Idempotency-Key`（1–64 个字符），缺失或长度不对：400 `IDEMPOTENCY_KEY_REQUIRED`（这项检查先于一切其它检查）。
   - 同一个 key、**相同**的请求（路径和请求内容都相同，JSON 字段顺序不影响）再次到来：不再执行，原样返回第一次的状态码和响应体，并带响应头 `Idempotent-Replay: true`（第一次的响应不带这个头）。
   - 同一个 key、**不同**的请求（包括不同接口）：409 `IDEMPOTENCY_MISMATCH`。三个接口共用同一个 key 空间。
   - 只有**成功**（2xx）的结果会被记住；因 4xx 失败的请求不占用 key，之后可以用同一个 key 重试。
   - 幂等记录必须与业务写入一起持久化：服务重启后，重放仍然返回原结果。
   - 同一个 key 的并发请求只能生效一次。
4. **流水**：每次余额变化都产生一条流水：`{seq, kind, amount_cents, ref, balance_after}`。`kind` ∈ `deposit` / `transfer_out` / `transfer_in` / `reversal_out` / `reversal_in`；`amount_cents` 带符号（入账为正、扣款为负）；`ref` 是产生它的入账 / 转账 / 冲正的 id；`balance_after` 是这条流水生效后的账户余额。`seq` 是全局严格递增、不重复的整数。
5. **分页**：`entries` 按 `seq` 升序；`limit` 默认 50，范围 1–200；`after` 是游标（返回 `seq` 大于它的流水，默认 0）。响应 `{entries: [...], next_after}`：还有更多时 `next_after` 为本页最后一条的 `seq`，否则为 `null`。参数不合法：400 `VALIDATION_ERROR`；账户不存在：404。
6. **不变量**：任意时刻，每个账户的流水金额之和等于其余额；`total_cents` 等于 `deposits_cents`（转账和冲正不创造也不消灭金额）；每笔转账 / 冲正恰有两条方向相反、金额相等的流水。

### 错误格式

所有错误统一返回 `{"error": {"code": "...", "message": "..."}}`。参数缺失、类型或范围不对（包括金额为 0、负数、小数、字符串、布尔值、超过上限）：400 `VALIDATION_ERROR`，先于 404 / 422。不存在的路径：404 `NOT_FOUND`。任何输入都不能让服务返回 500 或泄露堆栈。

## 愿望

请把它当成一个真的要管钱的服务来做。想一想：两个请求同时扣同一个账户会发生什么？重试一个超时的请求会发生什么？进程在写到一半时被杀掉会发生什么？

怎么设计存储、怎么加锁、怎么测试，都由你决定。
