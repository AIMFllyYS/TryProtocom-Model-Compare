# PayGate 支付网关 API（沙箱）

商户后端通过 HTTP 调用 PayGate。沙箱模拟器 `provider.py` 的行为与线上一致，并额外提供故障注入接口。启动：

```
PORT=9100 PROVIDER_KEY=sk_test_bench WEBHOOK_SECRET=whsec_bench python provider.py
```

你的服务从环境变量读取：`PROVIDER_URL`（网关地址）、`PROVIDER_KEY`、`WEBHOOK_SECRET`。

## 认证

所有 `/v1/*` 请求带 `Authorization: Bearer <PROVIDER_KEY>`，否则 401。

## 创建扣款

`POST /v1/charges`，必须带 `Idempotency-Key` 头，body：

```json
{"amount": 1999, "currency": "usd", "reference": "<商户订单号>", "notify_url": "http://127.0.0.1:8080/api/webhooks/pay"}
```

- `amount` 是以分为单位的正整数，`currency` 只支持 `usd`。
- 返回 201：`{"id": "ch_1", "object": "charge", "amount", "currency", "reference", "status": "pending", "created"}`。**扣款总是先返回 pending**，最终结果稍后通过 webhook 通知（也可以主动查询）。
- 相同的 `Idempotency-Key` + 相同 body：返回第一次的结果（响应头 `Idempotent-Replay: true`），不会再扣一次款。相同的键 + 不同的 body：409 `idempotency_conflict`。
- 结果规则：金额末两位是 13（例如 1913）的扣款会被拒绝（`failed`，`card_declined`），其余成功。

## 查询

- `GET /v1/charges/{id}`
- `GET /v1/charges?reference=<订单号>` → `{"data": [charge, ...]}`

`status` 取值：`pending` / `succeeded` / `failed`。

## 退款

`POST /v1/refunds`，必须带 `Idempotency-Key`，body：`{"charge": "ch_1", "amount": 500}`。

- 只有 `succeeded` 的扣款可以退款（否则 409 `charge_not_succeeded`）；累计退款不能超过扣款金额（否则 400 `refund_exceeds`）。
- 返回 201：`{"id": "re_2", "object": "refund", "charge", "amount", "status": "succeeded"}`；随后发 `refund.succeeded` webhook。

## Webhook

事件结构：

```json
{"id": "evt_7", "type": "charge.succeeded", "seq": 1, "data": {"charge_id": "ch_1", "reference": "12", "amount": 1999, "status": "succeeded"}}
```

- 类型：`charge.succeeded`、`charge.failed`、`refund.succeeded`（`data` 里另有 `refund_id`、`amount`）。
- `seq` 是同一笔扣款上事件的递增序号（扣款结果为 1，之后的退款依次递增）。
- **至少一次投递**：同一事件可能重复；不同事件可能乱序到达（例如退款通知先于扣款成功通知）；投递失败（非 2xx 或超时）会重试，最多 6 次。
- 签名：请求头 `Pay-Signature: t=<unix 秒>,v1=<hex>`，其中 `v1 = HMAC_SHA256(WEBHOOK_SECRET, "<t>." + 原始请求体字节)`。验证时必须使用原始字节，必须使用常量时间比较；`t` 与当前时间相差超过 300 秒的请求应拒绝（防重放）。
- 商户对已正常处理（包括重复事件）的事件返回 2xx。

## 沙箱控制接口（线上不存在）

均无需认证：

| 接口 | 作用 |
|---|---|
| `POST /__ctl/reset` | 清空全部状态 |
| `GET /__ctl/state` | 查看全部扣款、退款、投递记录与计数（`counters.charge_created` 是真实创建的扣款数） |
| `POST /__ctl/faults` | 注入故障：`{"endpoint": "charges_create"｜"refunds_create"｜"charges_get", "kind": "http500"｜"rate_limit"｜"timeout"｜"drop_after", "count": N, "hold_s": 6}` |
| `POST /__ctl/clear_faults` | 清除尚未触发的故障 |
| `POST /__ctl/config` | `{"deliver_delay_ms": 150, "webhook_mode": "normal"｜"duplicate"｜"hold"｜"off", "fail_next": N}` |
| `POST /__ctl/flush` | `webhook_mode=hold` 时把暂存的事件投递出去，`{"order": "reverse"}` 倒序投递 |

故障含义：`http500` 直接返回 500（**未处理**）；`rate_limit` 返回 429 并带 `Retry-After: 1`（**未处理**）；
`timeout` **已处理**，但延迟 `hold_s` 秒才响应；`drop_after` **已处理**，但不返回响应就断开连接。
