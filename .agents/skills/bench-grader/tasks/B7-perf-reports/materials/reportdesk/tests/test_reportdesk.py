"""随种子仓库提供的少量测试（对运行中的服务工作，读取 BASE_URL）。"""
import json
import os
import urllib.error
import urllib.request

import pytest

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:8080").rstrip("/")


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")


@pytest.fixture(autouse=True)
def fresh():
    assert call("POST", "/api/__bench/reset", {})[0] == 200


def test_monthly_has_twelve_months():
    s, j = call("GET", "/api/reports/monthly?year=2026")
    assert s == 200 and [m["month"] for m in j["months"]] == [f"2026-{i:02d}" for i in range(1, 13)]
    assert j["months"][11]["orders"] == 0


def test_create_and_cancel_order():
    s, o = call("POST", "/api/orders", {"customer_id": 1, "items": [{"product_id": 1, "qty": 2}]})
    assert s == 201 and o["status"] == "paid"
    assert call("POST", f"/api/orders/{o['id']}/cancel", {})[0] == 200
    assert call("POST", f"/api/orders/{o['id']}/cancel", {})[0] == 409
