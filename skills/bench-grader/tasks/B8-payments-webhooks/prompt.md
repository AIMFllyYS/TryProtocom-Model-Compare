# 任务：对接支付网关

## 契约

- 在工作目录的 `paydesk/` 里实现一个商户后端（语言与框架不限），对接 PayGate 支付网关。网关的接口文档与沙箱在 `provider-sim/`（`PROVIDER-API.md`、`provider.py`）。
- 服务按 `bench.json` 启动（`start` / `setup` / `test` / `health`），监听环境变量 `PORT`，数据文件取 `DB_PATH`。网关地址、密钥与 webhook 密钥来自环境变量 `PROVIDER_URL`、`PROVIDER_KEY`、`WEBHOOK_SECRET`（评测时由评测方设置，不要写死）。`BENCH_MODE=1` 时提供 `POST /api/__bench/reset`（清空你自己的订单数据，不需要碰网关）；`X-Bench-Now` 请求头存在时，webhook 的时间戳容忍窗口以它作为“当前时间”。
- 你的 webhook 地址是 `POST /api/webhooks/pay`；创建扣款时把 `notify_url` 设为 `http://127.0.0.1:$PORT/api/webhooks/pay`；`reference` 填商户订单号（订单 id 的十进制字符串）。
- 统一错误格式 `{"error": {"code": "...", "message": "..."}}`。

接口：

| 接口 | 说明 |
|---|---|
| `POST /api/orders` `{sku, amount_cents}` | 创建订单（`sku` 1–64 个字符，`amount_cents` 1–10000000 的整数，否则 400 `VALIDATION_ERROR`），201，返回订单 |
| `GET /api/orders/{id}`、`GET /api/orders?status=` | 查询；不存在 404 `NOT_FOUND` |
| `POST /api/orders/{id}/pay`（必须带 `Idempotency-Key` 头，缺少则 400 `IDEMPOTENCY_KEY_REQUIRED`） | 发起支付，金额只取自订单；响应 202 并返回订单。同一个键重复请求返回同样的结果；订单已支付返回 409 `ALREADY_PAID`；订单正在支付中或待核对返回 409 `PAYMENT_IN_PROGRESS`；支付失败后的订单可以用新的键重新支付。必须在 20 秒内响应 |
| `POST /api/webhooks/pay` | 接收网关事件；签名无效 400 `INVALID_SIGNATURE`，时间戳超出 300 秒 400 `STALE_TIMESTAMP`；已正常处理（含重复事件、未知订单）返回 200 |
| `POST /api/orders/{id}/refund`（必须带 `Idempotency-Key`，body `{amount_cents}`） | 全额或部分退款；订单未支付 409 `NOT_REFUNDABLE`；超过可退金额 409 `REFUND_EXCEEDS`；网关暂时不可用 502 `PROVIDER_UNAVAILABLE`（用同一个键重试必须是安全的）；成功 200 并返回订单 |
| `POST /api/admin/reconcile` | 对账：对所有“待确认”订单向网关查询真实结果并收敛，返回 `{"checked": n, "updated": n}` |

订单对象：`{id, sku, amount_cents, status, paid_cents, refunded_cents, charge_id}`。`status` 取值：`created`、`payment_pending`、`payment_unknown`（不确定网关是否已扣款）、`payment_review`（网关通知的金额与订单不符，待人工核对）、`paid`、`failed`、`partially_refunded`、`refunded`。

要求：乱序到达的事件也不能丢（先到的退款通知必须最终体现在订单里）。

- 你补的测试放在 `tests/` 下，对正在运行的服务工作（读取环境变量 `BASE_URL`；网关沙箱地址同样是 `PROVIDER_URL`），能用 `bench.json` 里的 `test` 命令运行。评测会把你的测试对着“带有常见支付对接错误的服务”跑，看它能不能发现问题。
- 写 `DECISIONS.md`：关键决策与原因、你有意没做的事、已知风险。
- 完成时在工作目录写 `FINAL_MESSAGE.md`：做了什么、怎么验证的、哪些没做或不确定。只写真实存在的内容。

## 愿望

我们要上线收款了。我希望：用户不会被多扣一分钱，我们不会少收一分钱，也不会多退一分钱——无论网关抽风、网络断开、通知重复、通知乱序、通知比响应先到，还是同一个请求被客户端狂点好几次。

沙箱网关可以注入这些故障（见 `PROVIDER-API.md`）。请像对待真钱一样对待它：每一类故障都用沙箱复现一遍，用扣款次数和金额来证明结果，而不是只看接口返回了什么。拿不准的状态，宁可明确标成“不确定”，也不要猜。
