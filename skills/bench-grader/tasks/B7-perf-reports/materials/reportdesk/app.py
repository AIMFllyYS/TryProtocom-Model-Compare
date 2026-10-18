"""ReportDesk：内部销售报表服务（功能正确，但很慢）。仅用 Python 标准库。"""
import json
import os
import re
import sqlite3
import threading
from datetime import date, datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import seed

PORT = int(os.environ.get("PORT", "8080"))
DB_PATH = os.environ.get("DB_PATH", "reportdesk.db")
LOCK = threading.RLock()


class ApiError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def connect():
    c = sqlite3.connect(DB_PATH, check_same_thread=False, isolation_level=None)
    c.execute("PRAGMA journal_mode=WAL")
    return c


DB = connect()


def load_seed():
    data = seed.generate()
    DB.execute("BEGIN")
    for t in ("order_items", "orders", "customers", "products"):
        DB.execute(f"DROP TABLE IF EXISTS {t}")
    DB.execute("CREATE TABLE products(id INTEGER PRIMARY KEY, name TEXT, price_cents INTEGER, category TEXT)")
    DB.execute("CREATE TABLE customers(id INTEGER PRIMARY KEY, name TEXT, region TEXT)")
    DB.execute("CREATE TABLE orders(id INTEGER PRIMARY KEY, customer_id INTEGER, status TEXT, created_at TEXT, total_cents INTEGER)")
    DB.execute("CREATE TABLE order_items(id INTEGER PRIMARY KEY, order_id INTEGER, product_id INTEGER, qty INTEGER, unit_cents INTEGER)")
    DB.executemany("INSERT INTO products VALUES(?,?,?,?)", data["products"])
    DB.executemany("INSERT INTO customers VALUES(?,?,?)", data["customers"])
    DB.executemany("INSERT INTO orders VALUES(?,?,?,?,?)", data["orders"])
    DB.executemany("INSERT INTO order_items VALUES(?,?,?,?,?)", data["items"])
    DB.execute("CREATE INDEX idx_items_order ON order_items(order_id)")
    DB.execute("COMMIT")


def ensure_seed():
    try:
        n = DB.execute("SELECT COUNT(*) FROM orders").fetchone()[0]
    except sqlite3.OperationalError:
        n = 0
    if n == 0:
        load_seed()


# ---------------------------------------------------------------- 慢速查询（每次请求都重新全量计算）
def all_orders():
    return DB.execute("SELECT id, customer_id, status, created_at, total_cents FROM orders").fetchall()


def items_of(oid):
    return DB.execute("SELECT product_id, qty, unit_cents FROM order_items WHERE order_id=?", (oid,)).fetchall()


def product_names():
    return {r[0]: r[1] for r in DB.execute("SELECT id, name FROM products").fetchall()}


def order_view(o):
    return {"id": o[0], "customer_id": o[1], "status": o[2], "created_at": o[3], "total_cents": o[4],
            "items": [{"product_id": i[0], "qty": i[1], "unit_cents": i[2]} for i in items_of(o[0])]}


def get_order(oid):
    for o in all_orders():
        if o[0] == oid:
            return o
    return None


def customer_summary(cid):
    c = None
    for row in DB.execute("SELECT id, name FROM customers").fetchall():
        if row[0] == cid:
            c = row
    if c is None:
        raise ApiError(404, "NOT_FOUND", "客户不存在")
    names = product_names()
    paid = [o for o in all_orders() if o[1] == cid and o[2] == "paid"]
    units = {}
    for o in paid:
        for pid, qty, _ in items_of(o[0]):
            units[pid] = units.get(pid, 0) + qty
    top = sorted(units.items(), key=lambda kv: (-kv[1], kv[0]))[:3]
    return {"customer_id": cid, "name": c[1], "orders_paid": len(paid), "spent_cents": sum(o[4] for o in paid),
            "last_order_at": max((o[3] for o in paid), default=None),
            "top_products": [{"product_id": p, "name": names[p], "units": u} for p, u in top]}


def top_products(d_from, d_to, limit):
    names = product_names()
    units, revenue = {}, {}
    for o in all_orders():
        if o[2] != "paid" or not (d_from <= o[3][:10] <= d_to):
            continue
        for pid, qty, unit in items_of(o[0]):
            units[pid] = units.get(pid, 0) + qty
            revenue[pid] = revenue.get(pid, 0) + qty * unit
    ranked = sorted(revenue.items(), key=lambda kv: (-kv[1], kv[0]))[:limit]
    return [{"rank": i + 1, "product_id": p, "name": names[p], "units": units[p], "revenue_cents": rev} for i, (p, rev) in enumerate(ranked)]


def monthly(year):
    out = [{"month": f"{year:04d}-{m:02d}", "orders": 0, "revenue_cents": 0} for m in range(1, 13)]
    for o in all_orders():
        if o[2] == "paid" and o[3][:4] == f"{year:04d}":
            row = out[int(o[3][5:7]) - 1]
            row["orders"] += 1
            row["revenue_cents"] += o[4]
    return out


def list_orders(customer_id, status, limit, offset):
    rows = [o for o in all_orders() if (customer_id is None or o[1] == customer_id) and (status is None or o[2] == status)]
    rows.sort(key=lambda o: (o[3], o[0]), reverse=True)
    return {"total": len(rows), "orders": [order_view(o) for o in rows[offset:offset + limit]]}


def create_order(cid, lines, now):
    if not any(r[0] == cid for r in DB.execute("SELECT id FROM customers").fetchall()):
        raise ApiError(404, "NOT_FOUND", "客户不存在")
    prices = {r[0]: r[1] for r in DB.execute("SELECT id, price_cents FROM products").fetchall()}
    for pid, _ in lines:
        if pid not in prices:
            raise ApiError(404, "NOT_FOUND", f"商品 {pid} 不存在")
    oid = max((o[0] for o in all_orders()), default=0) + 1
    total = sum(prices[p] * q for p, q in lines)
    DB.execute("INSERT INTO orders VALUES(?,?,?,?,?)", (oid, cid, "paid", now, total))
    for pid, qty in sorted(lines):
        DB.execute("INSERT INTO order_items(order_id, product_id, qty, unit_cents) VALUES(?,?,?,?)", (oid, pid, qty, prices[pid]))
    return order_view(get_order(oid))


def cancel_order(oid):
    o = get_order(oid)
    if o is None:
        raise ApiError(404, "NOT_FOUND", "订单不存在")
    if o[2] == "cancelled":
        raise ApiError(409, "ALREADY_CANCELLED", "订单已取消")
    DB.execute("UPDATE orders SET status='cancelled' WHERE id=?", (oid,))
    return order_view(get_order(oid))


def set_price(pid, cents):
    if DB.execute("SELECT id FROM products WHERE id=?", (pid,)).fetchone() is None:
        raise ApiError(404, "NOT_FOUND", "商品不存在")
    DB.execute("UPDATE products SET price_cents=? WHERE id=?", (cents, pid))
    return {"id": pid, "price_cents": cents}


# ---------------------------------------------------------------- 输入校验与路由
def parse_day(q, name):
    v = (q.get(name) or [None])[0]
    if v is None or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
        raise ApiError(400, "VALIDATION_ERROR", f"{name} 必须是 YYYY-MM-DD")
    try:
        date.fromisoformat(v)
    except ValueError:
        raise ApiError(400, "VALIDATION_ERROR", f"{name} 不是有效日期")
    return v


def parse_int(q, name, lo, hi, default=None):
    v = (q.get(name) or [None])[0]
    if v is None:
        if default is None:
            raise ApiError(400, "VALIDATION_ERROR", f"缺少 {name}")
        return default
    if not re.fullmatch(r"\d{1,9}", v) or not lo <= int(v) <= hi:
        raise ApiError(400, "VALIDATION_ERROR", f"{name} 必须是 {lo}–{hi} 的整数")
    return int(v)


def is_int(v, lo, hi):
    return isinstance(v, int) and not isinstance(v, bool) and lo <= v <= hi


def now_iso(headers):
    raw = headers.get("X-Bench-Now")
    if raw:
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        except ValueError:
            pass
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def route(method, path, query, headers, body):
    q = parse_qs(query)
    if path == "/health":
        return 200, {"ok": True}
    if path == "/api/__bench/reset" and method == "POST" and os.environ.get("BENCH_MODE") == "1":
        load_seed()
        return 200, {"ok": True}
    m = re.fullmatch(r"/api/customers/(\d+)/summary", path)
    if m and method == "GET":
        return 200, customer_summary(int(m.group(1)))
    if path == "/api/reports/top-products" and method == "GET":
        d_from, d_to = parse_day(q, "from"), parse_day(q, "to")
        if d_from > d_to:
            raise ApiError(400, "VALIDATION_ERROR", "from 不能晚于 to")
        return 200, {"items": top_products(d_from, d_to, parse_int(q, "limit", 1, 100, 10))}
    if path == "/api/reports/monthly" and method == "GET":
        return 200, {"months": monthly(parse_int(q, "year", 2000, 2100))}
    if path == "/api/orders" and method == "GET":
        cid = parse_int(q, "customer_id", 1, 10**9, 0) or None
        status = (q.get("status") or [None])[0]
        if status not in (None, "paid", "cancelled"):
            raise ApiError(400, "VALIDATION_ERROR", "status 只能是 paid 或 cancelled")
        return 200, list_orders(cid, status, parse_int(q, "limit", 1, 100, 20), parse_int(q, "offset", 0, 10**9, 0) if "offset" in q else 0)
    if path == "/api/orders" and method == "POST":
        if not isinstance(body, dict) or not is_int(body.get("customer_id"), 1, 10**9):
            raise ApiError(400, "VALIDATION_ERROR", "customer_id 必须是正整数")
        lines = body.get("items")
        if not isinstance(lines, list) or not 1 <= len(lines) <= 50:
            raise ApiError(400, "VALIDATION_ERROR", "items 必须是 1–50 项的数组")
        seen = set()
        for it in lines:
            if not isinstance(it, dict) or not is_int(it.get("product_id"), 1, 10**9) or not is_int(it.get("qty"), 1, 100):
                raise ApiError(400, "VALIDATION_ERROR", "每项需要正整数 product_id 与 1–100 的 qty")
            if it["product_id"] in seen:
                raise ApiError(400, "VALIDATION_ERROR", "同一商品不能重复出现")
            seen.add(it["product_id"])
        return 201, create_order(body["customer_id"], [(i["product_id"], i["qty"]) for i in lines], now_iso(headers))
    m = re.fullmatch(r"/api/orders/(\d+)/cancel", path)
    if m and method == "POST":
        return 200, cancel_order(int(m.group(1)))
    m = re.fullmatch(r"/api/products/(\d+)/price", path)
    if m and method == "PUT":
        if not isinstance(body, dict) or not is_int(body.get("price_cents"), 1, 10_000_000):
            raise ApiError(400, "VALIDATION_ERROR", "price_cents 必须是 1–10000000 的整数")
        return 200, set_price(int(m.group(1)), body["price_cents"])
    raise ApiError(404, "NOT_FOUND", "没有这个接口")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _send(self, status, payload):
        data = b"" if payload is None else json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _handle(self, method):
        try:
            n = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(n) if n else b""
            body = None
            if raw:
                try:
                    body = json.loads(raw)
                except ValueError:
                    raise ApiError(400, "VALIDATION_ERROR", "请求体不是合法 JSON")
            u = urlparse(self.path)
            with LOCK:
                status, payload = route(method, u.path, u.query, self.headers, body)
        except ApiError as e:
            status, payload = e.status, {"error": {"code": e.code, "message": e.message}}
        except Exception:  # noqa: BLE001
            status, payload = 500, {"error": {"code": "INTERNAL", "message": "服务器内部错误"}}
        self._send(status, payload)

    def do_GET(self):
        self._handle("GET")

    def do_POST(self):
        self._handle("POST")

    def do_PUT(self):
        self._handle("PUT")


class Server(ThreadingHTTPServer):
    request_queue_size = 256
    daemon_threads = True


if __name__ == "__main__":
    ensure_seed()
    Server(("127.0.0.1", PORT), Handler).serve_forever()
