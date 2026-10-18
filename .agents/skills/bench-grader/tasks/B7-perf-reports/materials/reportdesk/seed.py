"""确定性的演示数据生成器：每次调用得到完全相同的数据集。

服务启动时若数据库为空，或收到 POST /api/__bench/reset，都应该恢复成 generate() 的结果。
请不要修改这个文件里数据的生成方式：评测用同一份数据核对你的服务返回的数字。
"""
import random
from datetime import datetime, timedelta, timezone

CATEGORIES = ["office", "kitchen", "garden", "toys", "sports", "books", "audio", "travel"]
REGIONS = ["north", "south", "east", "west", "central"]


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def generate():
    r = random.Random(20261008)
    products = [(i, f"Product {i:03d}", r.randint(199, 99999), CATEGORIES[i % 8]) for i in range(1, 301)]
    price = {p[0]: p[2] for p in products}
    customers = [(i, f"Customer {i:04d}", REGIONS[r.randrange(5)]) for i in range(1, 2001)]
    start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    span = 638 * 86400  # 到 2026-09-30 结束
    stamps = sorted(r.randrange(span) for _ in range(20000))
    orders, items, iid = [], [], 1
    for oid, sec in enumerate(stamps, 1):
        cust = int(2000 * r.random() ** 1.5) + 1
        status = "cancelled" if r.random() < 0.08 else "paid"
        total = 0
        for pid in sorted(r.sample(range(1, 301), r.randint(1, 6))):
            qty = r.randint(1, 5)
            unit = max(1, price[pid] * r.randint(90, 100) // 100)
            items.append((iid, oid, pid, qty, unit))
            total += qty * unit
            iid += 1
        orders.append((oid, cust, status, iso(start + timedelta(seconds=sec)), total))
    return {"products": products, "customers": customers, "orders": orders, "items": items}
