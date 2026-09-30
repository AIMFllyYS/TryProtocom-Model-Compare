"""现有冒烟测试（均能通过，覆盖面很小）。"""
import json
import os
import urllib.error
import urllib.request

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:8080").rstrip("/")
NOW = "2026-10-08T07:00:00+08:00"


def call(method, path, body=None, token=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body else None, method=method)
    req.add_header("Content-Type", "application/json")
    req.add_header("X-Bench-Now", NOW)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")


def setup_function():
    call("POST", "/api/__bench/reset")


def test_health():
    assert call("GET", "/health")[0] == 200


def test_register_login_book():
    assert call("POST", "/api/users", {"student_id": "20260001", "name": "测试", "pin": "1234"})[0] == 201
    tok = call("POST", "/api/sessions", {"student_id": "20260001", "pin": "1234"})[1]["token"]
    s, b = call("POST", "/api/bookings", {"seat_id": "A01", "date": "2026-10-08", "start_hour": 9, "end_hour": 10}, tok)
    assert s == 201 and b["status"] == "active"


def test_seats():
    s, b = call("GET", "/api/seats")
    assert s == 200 and len(b["seats"]) == 20
