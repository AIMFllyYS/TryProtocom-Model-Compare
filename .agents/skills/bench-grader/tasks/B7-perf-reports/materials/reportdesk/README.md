# ReportDesk

内部销售报表服务（Python 标准库 + SQLite）。启动：`PORT=8080 DB_PATH=./reportdesk.db python app.py`（与 `bench.json` 的 `start` 一致）。

## 数据

`seed.py` 的 `generate()` 生成固定的演示数据：300 个商品、2000 个客户、20000 个订单（约 7 万条订单明细，时间范围 2025-01-01 至 2026-09-30）。服务启动时库为空就载入这份数据；`BENCH_MODE=1` 时 `POST /api/__bench/reset` 把数据恢复成这份数据。

## 接口（均返回 JSON；错误统一为 `{"error": {"code": "...", "message": "..."}}`）

| 接口 | 说明 |
|---|---|
| `GET /api/customers/{id}/summary` | 客户汇总：已付款订单数、累计金额、最近一单时间、购买件数最多的 3 个商品 |
| `GET /api/reports/top-products?from=&to=&limit=` | 日期区间（含两端，UTC 日期）内已付款订单的商品销售额排行 |
| `GET /api/reports/monthly?year=` | 某年 12 个月的已付款订单数与销售额 |
| `GET /api/orders?customer_id=&status=&limit=&offset=` | 订单列表（含明细），按创建时间倒序 |
| `POST /api/orders` | 创建订单（按当前商品价格成交，状态为 paid） |
| `POST /api/orders/{id}/cancel` | 取消订单（已取消返回 409） |
| `PUT /api/products/{id}/price` | 修改商品价格（只影响之后的新订单，已有订单明细里的成交价不变） |

字段细节以现有实现的行为为准；它们是正确的。

## 已知问题

见 `PERF-NOTES.md`。
