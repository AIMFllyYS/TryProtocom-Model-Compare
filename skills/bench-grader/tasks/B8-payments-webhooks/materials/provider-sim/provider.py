"""PayGate 沙箱模拟器（Python 标准库，单文件）。协议见 PROVIDER-API.md。

用法：PORT=9100 PROVIDER_KEY=sk_test_bench WEBHOOK_SECRET=whsec_bench python provider.py
它会模拟真实支付网关常见的“不讲道理”：异步出结果、webhook 至少一次投递（可能重复、乱序、延迟）、
请求超时但其实已处理、连接中途断开、限流、5xx。故障通过 /__ctl/* 控制接口按需注入。
"""
import hashlib
import hmac
import json
import os
import re
import socket
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

PORT = int(os.environ.get("PORT", "9100"))
KEY = os.environ.get("PROVIDER_KEY", "sk_test_bench")
SECRET = os.environ.get("WEBHOOK_SECRET", "whsec_bench")
LOCK = threading.RLock()


class State:
    def __init__(self):
        self.reset()

    def reset(self):
        self.charges = {}        # id -> dict
        self.refunds = {}        # id -> dict
        self.idem = {}           # (scope, key) -> (body_sha, status, json)
        self.faults = {"charges_create": [], "charges_get": [], "refunds_create": []}
        self.fail_next = 0
        self.deliver_delay_ms = 150
        self.webhook_mode = "normal"   # normal | duplicate | hold | off
        self.held = []
        self.deliveries = []
        self.seq = {}            # charge id -> last event seq
        self.counters = {"charge_requests": 0, "charge_created": 0, "replays": 0, "refund_requests": 0}
        self.n = 0
        self.evt = 0


S = State()
GEN = [0]  # 每次 reset 加 1


def sign(body: bytes, ts: int | None = None) -> str:
    t = int(ts if ts is not None else time.time())
    return f"t={t},v1=" + hmac.new(SECRET.encode(), f"{t}.".encode() + body, hashlib.sha256).hexdigest()


def deliver(url: str, event: dict) -> None:
    body = json.dumps(event, separators=(",", ":")).encode()
    rec = {"event_id": event["id"], "type": event["type"], "reference": event["data"].get("reference"), "statuses": []}
    with LOCK:
        S.deliveries.append(rec)
    for attempt in range(1, 7):
        try:
            req = urllib.request.Request(url, data=body, method="POST", headers={"Content-Type": "application/json", "Pay-Signature": sign(body)})
            with urllib.request.urlopen(req, timeout=5) as r:
                rec["statuses"].append(r.status)
                return
        except urllib.error.HTTPError as e:
            rec["statuses"].append(e.code)
        except Exception:  # noqa: BLE001
            rec["statuses"].append(0)
        time.sleep(0.2 * attempt)


def emit(charge: dict, etype: str, data: dict) -> None:
    with LOCK:
        S.seq[charge["id"]] = S.seq.get(charge["id"], 0) + 1
        S.evt += 1
        event = {"id": f"evt_{S.evt}", "type": etype, "seq": S.seq[charge["id"]], "data": {"charge_id": charge["id"], "reference": charge["reference"], **data}}
        mode, url = S.webhook_mode, charge.get("notify_url")
    if not url:
        return
    if mode == "off":
        with LOCK:
            S.deliveries.append({"event_id": event["id"], "type": etype, "reference": charge["reference"], "statuses": ["dropped"]})
        return
    if mode == "hold":
        with LOCK:
            S.held.append((url, event))
        return
    threading.Thread(target=deliver, args=(url, event), daemon=True).start()
    if mode == "duplicate":
        threading.Timer(0.05, deliver, args=(url, event)).start()


def settle(cid: str, gen: int = -1) -> None:
    with LOCK:
        ch = S.charges.get(cid)
        if ch is None or gen != GEN[0] or ch["status"] != "pending":  # reset 之后遗留的定时器不能作用到新状态上
            return
        decline = ch["amount"] % 100 == 13 or S.fail_next > 0
        if S.fail_next > 0 and ch["amount"] % 100 != 13:
            S.fail_next -= 1
        ch["status"] = "failed" if decline else "succeeded"
        if decline:
            ch["failure_code"] = "card_declined"
    emit(ch, "charge.failed" if decline else "charge.succeeded", {"amount": ch["amount"], "status": ch["status"]})


class ApiErr(Exception):
    def __init__(self, status, typ, code, msg="", headers=None):
        self.status, self.payload, self.headers = status, {"error": {"type": typ, "code": code, "message": msg}}, headers or {}


def view_charge(c):
    return {k: c[k] for k in ("id", "object", "amount", "currency", "reference", "status", "created") if k in c} | ({"failure_code": c["failure_code"]} if "failure_code" in c else {})


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def send_json(self, status, payload, headers=None):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def body_json(self):
        raw = self._raw
        try:
            return json.loads(raw) if raw else {}
        except ValueError:
            raise ApiErr(400, "invalid", "bad_json", "请求体不是合法 JSON")

    def pop_fault(self, endpoint):
        with LOCK:
            q = S.faults.get(endpoint) or []
            return q.pop(0) if q else None

    def handle_fault(self, fault, process):
        """处理故障注入；process() 执行真实业务并返回 (status, payload)。返回 True 表示已经响应完毕。"""
        kind = (fault or {}).get("kind")
        if kind == "http500":
            self.send_json(500, {"error": {"type": "api", "code": "internal", "message": "boom"}})
            return True
        if kind == "rate_limit":
            self.send_json(429, {"error": {"type": "rate_limit", "code": "too_many_requests"}}, {"Retry-After": "1"})
            return True
        status, payload, headers = process()
        if kind == "timeout":
            time.sleep(float(fault.get("hold_s", 6)))
        elif kind == "drop_after":
            self.close_connection = True
            try:
                self.connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            return True
        self.send_json(status, payload, headers)
        return True

    def idempotent(self, scope, make):
        key = self.headers.get("Idempotency-Key")
        if not key:
            raise ApiErr(400, "invalid", "idempotency_key_required", "需要 Idempotency-Key")
        raw = self._raw
        try:
            body = json.loads(raw) if raw else {}
        except ValueError:
            raise ApiErr(400, "invalid", "bad_json")
        sha = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()
        with LOCK:
            hit = S.idem.get((scope, key))
            if hit:
                if hit[0] != sha:
                    raise ApiErr(409, "idempotency", "idempotency_conflict", "同一个键对应了不同的请求体")
                S.counters["replays"] += 1
                return hit[1], hit[2], {"Idempotent-Replay": "true"}
            status, payload = make(body)
            S.idem[(scope, key)] = (sha, status, payload)
            return status, payload, {}

    # ------------------------------------------------------------ 业务
    def create_charge(self, body):
        amount, cur = body.get("amount"), body.get("currency")
        if not isinstance(amount, int) or isinstance(amount, bool) or amount < 1 or cur != "usd" or not isinstance(body.get("reference"), str):
            raise ApiErr(400, "invalid", "invalid_request", "amount 必须是正整数，currency 必须是 usd，reference 必须是字符串")
        S.counters["charge_requests"] += 1
        S.n += 1
        cid = f"ch_{S.n}"
        ch = {"id": cid, "object": "charge", "amount": amount, "currency": cur, "reference": body["reference"], "status": "pending",
              "created": int(time.time()), "notify_url": body.get("notify_url"), "refunded": 0}
        S.charges[cid] = ch
        S.counters["charge_created"] += 1
        threading.Timer(S.deliver_delay_ms / 1000.0, settle, args=(cid, GEN[0])).start()
        return 201, view_charge(ch)

    def create_refund(self, body):
        S.counters["refund_requests"] += 1
        ch = S.charges.get(body.get("charge"))
        amount = body.get("amount")
        if ch is None:
            raise ApiErr(404, "invalid", "charge_not_found")
        if not isinstance(amount, int) or isinstance(amount, bool) or amount < 1:
            raise ApiErr(400, "invalid", "invalid_request", "amount 必须是正整数")
        if ch["status"] != "succeeded":
            raise ApiErr(409, "invalid", "charge_not_succeeded")
        if amount > ch["amount"] - ch["refunded"]:
            raise ApiErr(400, "invalid", "refund_exceeds", "退款超过可退金额")
        ch["refunded"] += amount
        S.n += 1
        rid = f"re_{S.n}"
        S.refunds[rid] = {"id": rid, "object": "refund", "charge": ch["id"], "amount": amount, "status": "succeeded", "created": int(time.time())}
        threading.Timer(0.05, lambda g=GEN[0]: emit(ch, "refund.succeeded", {"refund_id": rid, "amount": amount}) if g == GEN[0] else None).start()
        return 201, S.refunds[rid]

    # ------------------------------------------------------------ 路由
    def route(self, method):
        u = urlparse(self.path)
        path, q = u.path, parse_qs(u.query)
        if path == "/health":
            return self.send_json(200, {"ok": True})
        if path.startswith("/__ctl/"):
            return self.ctl(method, path[len("/__ctl/"):])
        if self.headers.get("Authorization") != f"Bearer {KEY}":
            return self.send_json(401, {"error": {"type": "auth", "code": "invalid_api_key"}})
        if path == "/v1/charges" and method == "POST":
            fault = self.pop_fault("charges_create")
            return self.handle_fault(fault, lambda: self.idempotent("charge", self.create_charge))
        if path == "/v1/refunds" and method == "POST":
            fault = self.pop_fault("refunds_create")
            return self.handle_fault(fault, lambda: self.idempotent("refund", self.create_refund))
        if path == "/v1/charges" and method == "GET":
            fault = self.pop_fault("charges_get")
            def lst():
                ref = (q.get("reference") or [None])[0]
                with LOCK:
                    return 200, {"data": [view_charge(c) for c in S.charges.values() if ref is None or c["reference"] == ref]}, {}
            return self.handle_fault(fault, lst)
        m = re.fullmatch(r"/v1/charges/(ch_\d+)", path)
        if m and method == "GET":
            fault = self.pop_fault("charges_get")
            def one():
                with LOCK:
                    c = S.charges.get(m.group(1))
                    return (200, view_charge(c), {}) if c else (404, {"error": {"type": "invalid", "code": "charge_not_found"}}, {})
            return self.handle_fault(fault, one)
        return self.send_json(404, {"error": {"type": "invalid", "code": "not_found"}})

    def ctl(self, method, name):
        if name == "reset" and method == "POST":
            with LOCK:
                GEN[0] += 1
                S.reset()
            return self.send_json(200, {"ok": True})
        if name == "state":
            with LOCK:
                return self.send_json(200, {"charges": [dict(c) for c in S.charges.values()], "refunds": list(S.refunds.values()), "deliveries": S.deliveries,
                                            "counters": S.counters, "held": len(S.held), "idempotency_keys": [f"{s}:{k}" for (s, k) in S.idem]})
        body = self.body_json()
        if name == "faults" and method == "POST":
            with LOCK:
                S.faults[body["endpoint"]].extend([{k: v for k, v in body.items() if k not in ("endpoint", "count")}] * int(body.get("count", 1)))
            return self.send_json(200, {"ok": True})
        if name == "clear_faults" and method == "POST":
            with LOCK:
                for k in S.faults:
                    S.faults[k] = []
            return self.send_json(200, {"ok": True})
        if name == "config" and method == "POST":
            with LOCK:
                if "deliver_delay_ms" in body:
                    S.deliver_delay_ms = int(body["deliver_delay_ms"])
                if "webhook_mode" in body:
                    S.webhook_mode = body["webhook_mode"]
                if "fail_next" in body:
                    S.fail_next = int(body["fail_next"])
            return self.send_json(200, {"ok": True})
        if name == "flush" and method == "POST":
            with LOCK:
                items, S.held = S.held, []
            if body.get("order") == "reverse":
                items.reverse()
            for url, ev in items:
                deliver(url, ev)
            return self.send_json(200, {"delivered": len(items)})
        return self.send_json(404, {"error": {"code": "not_found"}})

    def _go(self, method):
        try:
            n = int(self.headers.get("Content-Length") or 0)
            self._raw = self.rfile.read(n) if n else b""  # 先读完请求体：故障注入提前返回时也不能留下半截数据污染长连接
            self.route(method)
        except ApiErr as e:
            self.send_json(e.status, e.payload, e.headers)
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        except Exception as e:  # noqa: BLE001
            try:
                self.send_json(500, {"error": {"type": "api", "code": "internal", "message": str(e)}})
            except OSError:
                pass

    def do_GET(self):
        self._go("GET")

    def do_POST(self):
        self._go("POST")


class Server(ThreadingHTTPServer):
    request_queue_size = 256
    daemon_threads = True


if __name__ == "__main__":
    Server(("127.0.0.1", PORT), Handler).serve_forever()
