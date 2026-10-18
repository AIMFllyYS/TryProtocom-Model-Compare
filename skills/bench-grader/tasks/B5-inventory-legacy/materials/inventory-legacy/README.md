# 库存服务

仓库管理系统的库存后端。Python 3.11 标准库实现，没有第三方依赖。

## 运行

```
PORT=8080 DB_PATH=./inventory.db python app.py
```

- `GET /health`
- 设置 `BENCH_MODE=1` 时提供 `POST /api/__bench/reset`（清空数据，仅供测试）
- 请求头 `X-Bench-Now`（ISO 8601）存在时，服务用它作为“当前时间”（预留过期用），便于测试；不存在时用真实时间

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/items` | 新建商品 `{sku, name, price_cents, stock?, threshold?}` |
| GET | `/api/items?q=&sort=&limit=&offset=` | 列表（`sort`: name / stock / price / sku；`q` 搜索名称或 sku），返回 `{items, total, limit, offset}` |
| GET | `/api/items/{sku}` | 商品详情，含 `available`（库存减去有效预留）与 `low_stock` |
| POST | `/api/items/{sku}/adjust` | 调整库存 `{delta, reason?}` |
| POST | `/api/reservations` | 预留 `{sku, qty, ttl_s?}`；预留期间占用可用库存 |
| POST | `/api/reservations/{id}/commit` | 提交预留（扣减库存） |
| POST | `/api/reservations/{id}/release` | 释放预留 |
| GET | `/api/reports/valuation` | 库存总值 `{total_value_cents, items_count}` |

错误统一为 `{"error": {"code": "...", "message": "..."}}`。

## 测试

```
python -m unittest discover -s tests -v
```

测试针对一个正在运行的服务实例，地址取环境变量 `BASE_URL`（默认 `http://127.0.0.1:8080`），先启动服务再运行。
