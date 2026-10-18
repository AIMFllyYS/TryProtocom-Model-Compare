# 后端题族（B1–B8）

v2 用八道后端题测“能不能自己把一个服务做对”。创作题看页面和镜头，后端题看协议、状态、并发、故障、安全和性能。公开的示例测试只能说明作者会写测试，不能说明实现是对的，所以判分用评测方私有的黑盒测试。`tasks/*/hidden/` 不会复制进模型工作区；`materials/` 会。

三层检验回答三个不同的问题：

- 隐藏测试：参考实现（或修好的种子）必须全过。它定义“怎样才算做对”。
- 变异检验：把参考实现里的一处正确逻辑改错，看隐藏测试能不能发现。它定义“测试有没有打在要点上”。模型自带测试另有一轮变异检验（`api.mut_score`），看模型自己写的测试能不能抓住常见回归。
- 缺陷基线：把有意做坏的种子或朴素实现当作交付再跑一遍。该失败的命名检查必须失败，不该被改坏的原有功能仍要通过。它防止测试写得过宽，把错误实现也判成对。

评分入口是 `skills/bench-grader/scripts/bench.py`。指标由 `scripts/benchlib/probes/api.py` 的 api 探针产出，再按各题 `rubric.yaml` 折算成分数。公共门槛、工程项和 Agent 项在 `tasks/_common/backend.yaml`，各题用 `extends: [backend]` 引入。

## 公共契约

每道题的 `prompt.md` 都有“契约”一节。模型交付里要有 `bench.json`，字段为 `start`、`setup`、`test`、`health`。评测时：

- 评测方按 `start` 启动服务，健康检查打 `health`（默认 `/health`）。
- 环境变量 `PORT` 是监听端口，`DB_PATH` 是数据文件路径。
- `BENCH_MODE=1` 时必须提供 `POST /api/__bench/reset`，把服务恢复到可重复的初始状态。
- 需要时间语义的题认请求头 `X-Bench-Now`（ISO 时间）。忽略它会在租约、过期、封禁、报表月份上丢分。
- 错误统一为 `{"error": {"code": "...", "message": "..."}}`。
- 自带测试放在 `tests/`，对正在运行的服务发请求，地址读环境变量 `BASE_URL`。B6 还会给测试进程 `DB_PATH`（与服务相同），用来检查口令是否明文落盘。
- 交接文档至少包括 `README.md`。从零实现的题还要 `DECISIONS.md`。改预置仓库的题改为 `FIXES.md`、`SECURITY-FIXES.md` 或 `PERF-REPORT.md`（以各题契约为准）。
- 结束时在工作目录写 `FINAL_MESSAGE.md`。只写真实存在的文件和真实跑过的验证。

运行时依赖：评测机有 Python 3.11（`benchmark.yaml` 的 `external.api_python`）和 Node 22。题目本身可以只用标准库。引入运行时第三方依赖在 B5–B7 上会扣分。

## 逐题

### B1 停车场计费（parking-quote）

把一页精确的计费规则转成 HTTP 服务。考的是规则忠实度、边界和输入校验，不是架构。

- 交付目录 `parking-quote`。没有预置仓库。
- `hidden/`：`reference_server.py`、`test_quote.py`、`diff_driver.py`、`mutants.json`（20）。
- 探针：隐藏测试，加 400 个随机请求与参考实现做差分（`api.diff_match_ratio`），以及健康检查压测。
- 局限：差分只覆盖驱动器生成的请求形状，没有单列的缺陷仓库。

### B2 账务与转账（ledger）

幂等键、并发转账、冲正、分页流水。考的是不超支、不死锁，以及进程被强杀之后已确认的操作不丢、账务守恒。

- 交付目录 `ledger`。
- `hidden/`：`reference_server.py`、`test_ledger.py`、`test_chaos.py`、`mutants.json`（22）。
- 探针：隐藏测试，加混沌（负载下结束进程再拉起，`api.chaos_ok`），以及压测。
- 局限：混沌只覆盖单进程、评测方主动杀掉进程这一种崩溃，不覆盖断电写到一半的磁盘。

### B3 作业队列（job-queue）

优先级、延迟可见、租约、指数退避、死信、至少一次投递。

- 交付目录 `job-queue`。
- `hidden/`：`reference_server.py`、`test_queue.py`、`test_chaos.py`、`mutants.json`（35）。
- 探针：隐藏测试（类别 func / order / lease / retry / edge / conc），混沌，压测。
- 变异：隐藏测试 35/35 能杀死。
- 局限：时间边界依赖 `X-Bench-Now`，用真实睡眠的实现会超时或误判。

### B4 对象存储的 HTTP 语义（blob-http）

PUT / GET / HEAD / DELETE、ETag、条件请求的求值顺序、单段 Range、If-Range、并发写。

- 交付目录 `blob-http`。
- `hidden/`：`reference_server.py`、`test_blob.py`、`test_persist.py`、`diff_driver.py`、`mutants.json`（32）。
- 探针：隐藏测试，重启后数据仍在（`api.persist_ok`），500 个随机 Range / 条件头与参考实现差分，模型自带测试的变异检验（上限 12 个变异体），压测。
- 变异：隐藏测试 32/32 能杀死。
- 局限：差分比较的是状态码和 ETag 是否存在，不比较 ETag 的具体字节（两边实现可以不同）。模糊的 Range 写法（例如单位写成 BYTES、带空白）不在差分池里。

### B5 库存遗留缺陷（inventory-legacy）

预置一个能跑但有缺陷的库存服务。已报告 5 条，另有 1 条未报告。要求在原项目上修，补回归测试，并实现新报表。不重写。

- 交付目录 `inventory-legacy`（工作区里已有 `materials/inventory-legacy/` 的副本）。
- `hidden/`：`reference_server.py`、`test_inventory.py`、`reference_tests.py`（一份“写得不错的自带测试”样例，用来校验变异检验管线）、`mutants.json`（20）。
- 探针：文件是否还在、与种子的 diff（改动比例、是否引入依赖、新增了多少测试）、`FIXES.md` 是否提到关键缺陷、隐藏测试、自带测试变异检验。
- 变异：隐藏测试 20/20 能杀死。
- 缺陷基线：种子仓库必须在指定别名上失败，同时原有功能回归保持高通过率。
- 局限：估价缺陷用“逐项先截成整数”才能稳定复现，浮点碰巧算对的路径不算修好。

### B6 TeamNotes 安全加固（teamnotes）

预置笔记服务。外部渗透报告只列了 4 类，服务里实际有 12 类（注入、越权、路径穿越、口令存储、会话、登录限流、用户名枚举、批量赋值、SSRF、错误泄露、上传大小）。

- 交付目录 `teamnotes`。
- `hidden/`：`reference_server.py`、`test_security.py`、`reference_tests.py`、`mutants.json`（27）。
- 探针：与种子的 diff、`SECURITY-FIXES.md` 是否提到 SSRF / 穿越 / 慢哈希 / 限流、隐藏测试（类别 func / auth / authz / inj / file / ssrf / leak）、自带测试变异检验。
- 收集到的隐藏测试约 55 条（含参数化）。变异 27/27 能杀死。缺陷基线：种子在 sqli、idor、passwords、xss、traversal、tokens、ratelimit、enum、mass、ssrf、leak、dos 上全部失败，回归比例为 1（这些攻击测试已从回归集合剔除）。
- 局限：口令检查只能识别明文、base64 和未加盐的快速哈希（md5 / sha1 / sha256）。慢哈希的具体算法不强制。SSRF 用本机金丝雀，不能离线证明“允许的公网地址真的能抓到”。

### B7 ReportDesk 提速（reportdesk）

预置报表服务，数字是对的，查询是慢的。要求变快，且数字、排序、写后读一致、并发计入都不许变。

- 交付目录 `reportdesk`。种子在 `materials/reportdesk/`（`app.py`、确定性数据 `seed.py`）。
- `hidden/`：`test_reports.py`、`seedgen.py`（与种子同一份生成器，测试用它自己算期望值）、`reference_tests.py`、`mutants.json`（24）、`_reference_body.py`、`build_reference.py`、生成出的 `reference_server.py`。
- 参考实现把种子源码以 base64 嵌进单文件，查询换成索引和 SQL 聚合。改 `_reference_body.py` 之后必须在该目录运行 `python build_reference.py`，否则评测仍用旧的 `reference_server.py`。
- 探针：隐藏测试（func / edge / fresh / conc，约 52 条）、同一组请求下与种子实现比 p95（`api.speedup`）。`api.speedup_gated` 只在 func 与 fresh 全部通过且压测无错误时等于加速比，否则为 0。模型自带测试变异检验上限 12。
- 缺陷基线：种子对自己，加速比不得超过 `calibration.defect_max_speedup`（1.3）。没有“必须失败”的功能别名，因为种子功能是对的。
- 局限：绝对毫秒数随机器负载变化，只在同一台评测机上与基线比才有意义。不要在跑变异检验的同时测速度。

### B8 PayDesk 支付对接（paydesk）

从零实现商户后端，对接会抽风的支付网关：先返回 pending、webhook 至少一次、可能重复和乱序、5xx、429、已处理但超时、已处理但连接被掐断。

- 交付目录 `paydesk`。沙箱和协议在 `materials/provider-sim/`（`provider.py`、`PROVIDER-API.md`），这是给模型的材料，不是隐藏内容。
- `hidden/`：`reference_server.py`、`test_pay.py`（37 条）、`reference_tests.py`（11 条）、`mutants.json`（25）、`naive/`（只把顺利路径跑通的朴素实现，用作缺陷基线）。
- 探针：评测方先启动沙箱（sidecar），把 `PROVIDER_URL` 注入被测服务，再跑隐藏测试。类别 func / idem / fault / hook / refund / recon / conc。模型自带测试变异检验上限 12。
- 缺陷基线：朴素实现必须在签名、重放窗口、去重、乱序、金额不符、幂等、稳定网关键、重试、结果未知、状态覆盖、退款只一次、对账这些别名上失败。
- 等价变异（已从 `mutants.json` 删除，不要加回去）：
  - 在 `provider()` 调用处拼接 `time_ns` 只求值一次，同一次调用里的重试仍共用一个键。真正会重复扣款的是重试循环内部换键，这一条留在 m11。
  - 退款不按订单加锁：沙箱自己串行，第二笔超额会被拒绝，商户侧结果仍是一笔。
  - 商户不拦截超额退款：沙箱返回 400，商户仍回 409。
- 对账必须看同一订单的最后一笔扣款，不看第一笔。隐藏测试 `test_recon_latest_charge_wins_after_a_failed_attempt` 专门杀“只看第一笔”。
- 局限：沙箱和参考实现都是单进程。不覆盖多实例抢同一笔订单，也不覆盖进程死在“网关已扣款、本地还没记下”之间的那一下。超时和限流用例依赖真实等待（大约 1 秒和 5 秒），机器很忙时可能偶发超时，先原样再跑一次再判断。

## 怎么跑验证

在 `skills/bench-grader/scripts` 下执行。输出重定向到文件，不要用管道接 `Select-Object`（子进程占着管道时命令会挂住）。PowerShell 5 的重定向是 UTF-16，用 `Get-Content -Encoding Unicode` 读。

自测，把参考实现当作交付：

```
python bench.py backend-check B8 > C:\Users\AIMFl\AppData\Local\Temp\b8_self.txt 2>&1
```

看 `ok`、`failed`、`api.tests_passed`、`api.cat.*`、`api.test.*`。B3 还要 `api.chaos_ok` 为 true。B4 还要 `api.persist_ok` 为 true 且 `api.diff_match_ratio` 为 1。长任务放后台，不要和 B7 的速度测量同时跑。

缺陷基线：

```
python bench.py backend-check B6 --defect > C:\Users\AIMFl\AppData\Local\Temp\b6_def.txt 2>&1
```

`wrong_pass` 必须为空。若设置了 `defect_min_regression`，`api.regression_ratio` 不得低于它。若设置了 `defect_max_speedup`，`api.speedup` 不得高于它（`backend_check.defect` 把这两项写进 `ok`）。

全量变异（隐藏测试能否杀死 `hidden/mutants.json` 里的每一个）：

```
python C:\Users\AIMFl\AppData\Local\Temp\mut_sum.py B3 > C:\Users\AIMFl\AppData\Local\Temp\b3_mut.txt 2>&1
```

`valid_failures` 必须为空（参考实现自己不能有失败）。`invalid` 表示 `find` 文本没有命中参考实现，要改变异体，不要改参考实现去迎合它。`survived` 表示测试没发现这个错误：补一条在参考实现上能通过的测试，或确认它是等价变异后删除。

单条用例可以用临时目录里的 `dbg_ref.py`、`dbg_own.py`。B8 必须用 `dbg_b8.py`，因为它要同时拉起沙箱。

全部 rubric：

```
python bench.py validate-rubrics
```

## 新增一道后端题

1. 在 `tasks/<id>-<slug>/` 建目录。`rubric.yaml` 写 `suite` 由 `backend.yaml` 继承为 v2，`kind` 同样继承。`extends: [backend]`。`prompt.md` 至少有 `## 契约`。
2. 契约里写清交付目录、`bench.json`、环境变量、`/api/__bench/reset`、错误格式、自带测试读 `BASE_URL`。愿望段只写想看到的行为，不写实现手段。
3. `hidden/reference_server.py` 用标准库实现正确行为。`hidden/test_*.py` 只通过 HTTP 说话，类别写进函数名前缀 `test_<类别>_`。需要的共用模块放进 api 探针的 `support`（通常含 `../_common/hidden/bt.py`）。
4. `named_tests` 里的每个名字必须在测试文件里有对应的 `def`。`regression_exclude` 同样。参数化用例只写基础名。评分项里的 `api.test.<别名>` 必须在 `named_tests` 里。
5. `mutants.json` 的每一项要么是 `find` + `replace`（可加 `count`），要么是 `edits` 数组。`edits` 里任意一处对不上，整条变异作废。改完用变异脚本确认没有 `invalid`，且参考实现的 `valid_failures` 为空。
6. 若要测模型自带测试，加 `hidden/reference_tests.py`（只依赖 `BASE_URL` 以及契约里承诺的环境变量），并在探针里写 `own_test_mutation`。
7. 有预置仓库时，种子放 `materials/`，`calibration.defect_src` 指向它。`defect_must_fail` 用命名别名，不要用单条测试名。
8. 在 `workbench/shared/deliverables.ts` 登记交付目录和必须存在的文件，并与契约保持一致。
9. `python bench.py validate-rubrics`，再 `backend-check` 自测和 `--defect`。

## 局限（读榜单的人需要知道）

- 边界探针只在运行日志里找“读了 hidden / 别的模型产物”的线索，不是沙箱。它不能证明模型没偷看。
- 自带测试的变异检验要求测试遵守 `BASE_URL`。不遵守的测试在这一项上得分低，不代表实现是错的。
- B6 不能识别“加盐但仍过快”的哈希，也不能离线验证合法的公网抓取。
- B7 的加速比是同一台机器、同一组 URL 上的相对值。换机器或在高负载下测量，数字会变，阈值要重核。
- B8 不覆盖多实例，也不覆盖崩溃窗口。沙箱的超额保护可能让商户侧的重复检查变成等价变异。
- 隐藏测试全过只说明参考实现符合这套测试。测试没写到的行为，榜单上看不出来。

## 本轮实测记录

数字与取舍的说明在 `v2-calibration-runbook.md` 第 1 节。这里只留索引：

- B3 / B4 / B5 / B6 的隐藏测试变异分别是 35/35、32/32、20/20、27/27。
- B6 缺陷基线通过，回归比例 1.0。
- B7 隐藏测试 53/53，变异 24/24，参考实现加速比 5.79，缺陷基线加速比 0.98（上限 1.3）。速度满分线是 5 倍。
- B8 参考实现自测 38/38，自带测试变异 12/12。缺陷基线回归比例 0.556，门槛 0.5。
- 总回归全部 `ok`：B1 58/58（差分 1.0），B2 46/46（混沌通过），B3 55/55（混沌通过），B4 70/70（持久化通过，差分 1.0），B5 39/39 且缺陷基线通过，B6 57/57。
