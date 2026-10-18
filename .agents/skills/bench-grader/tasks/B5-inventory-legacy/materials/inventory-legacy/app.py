"""库存服务（Python 标准库实现）。运行：python app.py；环境变量 PORT、DB_PATH。"""
import json
import os
import re
import sqlite3
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

DB_PATH = os.environ.get("DB_PATH", "inventory.db")
SKU = re.compile(r"[A-Z0-9-]{1,20}")
SORTS = {"name": "name", "stock": "stock", "price": "price_cents", "sku": "sku"}


def db():
    c = sqlite3.connect(DB_PATH, timeout=30, isolation_level=None)
    c.execute("PRAGMA journal_mode=WAL")
    return c


def init():
    c = db()
    c.executescript("""
    CREATE TABLE IF NOT EXISTS items(sku TEXT PRIMARY KEY, name TEXT NOT NULL, price_cents INTEGER NOT NULL, stock INTEGER NOT NULL, threshold INTEGER NOT NULL DEFAULT 5);
    CREATE TABLE IF NOT EXISTS reservations(id INTEGER PRIMARY KEY AUTOINCREMENT, sku TEXT NOT NULL, qty INTEGER NOT NULL, state TEXT NOT NULL, expires_ms INTEGER NOT NULL);
    """)
    c.close()


init()


class ApiError(Exception):
    def __init__(self, status, code, message=""):
        self.status, self.code, self.message = status, code, message or code


def now_ms(headers):
    v = headers.get("X-Bench-Now")
    if not v:
        return int(time.time() * 1000)
    try:
        return int(datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp() * 1000)
    except ValueError:
        raise ApiError(400, "VALIDATION_ERROR", "X-Bench-Now 格式不正确")


def audit(line):
    # 审计日志：每次库存相关操作都落一行（也是读-判-写之间真实存在的一段 I/O）
    with open(DB_PATH + ".audit.log", "a", encoding="utf-8") as f:
        f.write(line + "\n")
        f.flush()
        os.fsync(f.fileno())


def reserved_qty(c, sku, now):
    r = c.execute("SELECT COALESCE(SUM(qty),0) FROM reservations WHERE sku=? AND state='held'", (sku,)).fetchone()
    return r[0]


def item_view(c, row, now):
    sku, name, price, stock, thr = row
    avail = stock - reserved_qty(c, sku, now)
    return {"sku": sku, "name": name, "price_cents": price, "stock": stock, "available": avail, "low_stock": avail < thr, "threshold": thr}


def get_item(c, sku):
    r = c.execute("SELECT sku,name,price_cents,stock,threshold FROM items WHERE sku=?", (sku,)).fetchone()
    if not r:
        raise ApiError(404, "NOT_FOUND", "商品不存在")
    return r


def int_in(v, lo, hi, name):
    if isinstance(v, bool) or not isinstance(v, int) or not lo <= v <= hi:
        raise ApiError(400, "VALIDATION_ERROR", f"{name} 必须是 {lo}–{hi} 的整数")
    return v


def list_items(c, query, now):
    q = parse_qs(query)
    term = q.get("q", [""])[0]
    sort = q.get("sort", ["name"])[0]
    if sort not in SORTS:
        raise ApiError(400, "VALIDATION_ERROR", "sort 只能是 name / stock / price / sku")
    try:
        limit, offset = int(q.get("limit", ["20"])[0]), int(q.get("offset", ["0"])[0])
    except ValueError:
        raise ApiError(400, "VALIDATION_ERROR", "limit / offset 必须是整数")
    if not 1 <= limit <= 100 or offset < 0:
        raise ApiError(400, "VALIDATION_ERROR", "limit 1–100，offset ≥ 0")
    where, args = (f"WHERE name LIKE '%{term}%' OR sku LIKE '%{term}%'", []) if term else ("", [])
    total = c.execute("SELECT COUNT(*) FROM items").fetchone()[0]
    rows = c.execute(f"SELECT sku,name,price_cents,stock,threshold FROM items {where} LIMIT ? OFFSET ?", [*args, limit, offset]).fetchall()
    rows.sort(key=lambda r: r[{"name": 1, "stock": 3, "price": 2, "sku": 0}[sort]])
    return {"items": [item_view(c, r, now) for r in rows], "total": total, "limit": limit, "offset": offset}


def like_escape(s):
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def route(method, path, query, headers, body):
    now = now_ms(headers)
    b = body if isinstance(body, dict) else {}
    if path == "/health":
        return 200, {"ok": True}
    c = db()
    try:
        if path == "/api/__bench/reset" and method == "POST" and os.environ.get("BENCH_MODE") == "1":
            c.execute("DELETE FROM items")
            c.execute("DELETE FROM reservations")
            return 200, {"ok": True}
        if path == "/api/items" and method == "POST":
            sku, name = b.get("sku"), b.get("name")
            if not isinstance(sku, str) or not SKU.fullmatch(sku):
                raise ApiError(400, "VALIDATION_ERROR", "sku 只能是 1–20 个大写字母、数字或 -")
            if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80:
                raise ApiError(400, "VALIDATION_ERROR", "name 必须是 1–80 个字符")
            price = int_in(b.get("price_cents"), 0, 100_000_000, "price_cents")
            stock = int_in(b.get("stock", 0), 0, 1_000_000, "stock")
            thr = int_in(b.get("threshold", 5), 0, 1_000_000, "threshold")
            try:
                c.execute("INSERT INTO items VALUES(?,?,?,?,?)", (sku, name.strip(), price, stock, thr))
            except sqlite3.IntegrityError:
                raise ApiError(409, "SKU_EXISTS", "sku 已存在")
            return 201, item_view(c, get_item(c, sku), now)
        if path == "/api/items" and method == "GET":
            return 200, list_items(c, query, now)
        if path == "/api/reports/valuation" and method == "GET":
            total = sum(int(p / 100 * s * 100) for p, s in c.execute("SELECT price_cents, stock FROM items").fetchall())
            n = c.execute("SELECT COUNT(*) FROM items").fetchone()[0]
            return 200, {"total_value_cents": total, "items_count": n}
        m = re.fullmatch(r"/api/items/([^/]+)", path)
        if m and method == "GET":
            return 200, item_view(c, get_item(c, unquote(m.group(1))), now)
        m = re.fullmatch(r"/api/items/([^/]+)/adjust", path)
        if m and method == "POST":
            sku = unquote(m.group(1))
            delta = int_in(b.get("delta"), -1_000_000, 1_000_000, "delta")
            if delta == 0:
                raise ApiError(400, "VALIDATION_ERROR", "delta 不能为 0")
            row = get_item(c, sku)
            avail = row[3] - reserved_qty(c, sku, now)
            if delta < 0 and avail + delta < 0:
                raise ApiError(409, "INSUFFICIENT_STOCK", "可用库存不足")
            c.execute("UPDATE items SET stock=stock+? WHERE sku=?", (delta, sku))
            audit(f"adjust {sku} {delta}")
            return 200, item_view(c, get_item(c, sku), now)
        if path == "/api/reservations" and method == "POST":
            sku = b.get("sku")
            qty = int_in(b.get("qty"), 1, 1000, "qty")
            ttl = int_in(b.get("ttl_s", 600), 1, 86400, "ttl_s")
            if not isinstance(sku, str):
                raise ApiError(400, "VALIDATION_ERROR", "sku 必须是字符串")
            row = get_item(c, sku)
            avail = row[3] - reserved_qty(c, sku, now)
            audit(f"reserve-check {sku} {qty} avail={avail}")
            if qty > avail:
                raise ApiError(409, "INSUFFICIENT_STOCK", "可用库存不足")
            cur = c.execute("INSERT INTO reservations(sku,qty,state,expires_ms) VALUES(?,?,'held',?)", (sku, qty, now + ttl * 1000))
            return 201, {"id": cur.lastrowid, "sku": sku, "qty": qty, "state": "held", "expires_at": iso(now + ttl * 1000)}
        m = re.fullmatch(r"/api/reservations/(\d+)/(commit|release)", path)
        if m and method == "POST":
            rid, act = int(m.group(1)), m.group(2)
            r = c.execute("SELECT id,sku,qty,state,expires_ms FROM reservations WHERE id=?", (rid,)).fetchone()
            if not r:
                raise ApiError(404, "NOT_FOUND", "预留不存在")
            if r[3] != "held":
                raise ApiError(409, "NOT_HELD", f"预留已是 {r[3]} 状态")
            if r[4] <= now:
                c.execute("UPDATE reservations SET state='expired' WHERE id=?", (rid,))
                raise ApiError(409, "EXPIRED", "预留已过期")
            if act == "commit":
                c.execute("UPDATE items SET stock=stock-? WHERE sku=?", (r[2], r[1]))
                c.execute("UPDATE reservations SET state='committed' WHERE id=?", (rid,))
            else:
                c.execute("UPDATE reservations SET state='released' WHERE id=?", (rid,))
            audit(f"{act} {rid}")
            return 200, {"id": rid, "sku": r[1], "qty": r[2], "state": "committed" if act == "commit" else "released"}
        raise ApiError(404, "NOT_FOUND")
    finally:
        c.close()


def iso(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _send(self, status, obj):
        data = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
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
                    body = json.loads(raw.decode())
                except ValueError:
                    raise ApiError(400, "VALIDATION_ERROR", "请求体不是合法 JSON")
            u = urlparse(self.path)
            status, resp = route(method, u.path, u.query, self.headers, body)
            self._send(status, resp)
        except ApiError as e:
            self._send(e.status, {"error": {"code": e.code, "message": e.message}})
        except Exception:  # noqa: BLE001
            self._send(500, {"error": {"code": "INTERNAL", "message": "internal error"}})

    do_GET = lambda self: self._handle("GET")  # noqa: E731
    do_POST = lambda self: self._handle("POST")  # noqa: E731


class Server(ThreadingHTTPServer):
    request_queue_size = 256
    daemon_threads = True


if __name__ == "__main__":
    Server(("127.0.0.1", int(os.environ.get("PORT", "8080"))), H).serve_forever()
