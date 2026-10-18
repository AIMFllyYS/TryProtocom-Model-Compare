import json
import os
import unittest
import urllib.error
import urllib.request

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:8080").rstrip("/")


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")


class InventoryTest(unittest.TestCase):
    def setUp(self):
        status, _ = call("POST", "/api/__bench/reset", {})
        self.assertIn(status, (200, 204))

    def add(self, sku, stock=10, price=100, **kw):
        status, body = call("POST", "/api/items", {"sku": sku, "name": f"Item {sku}", "price_cents": price, "stock": stock, **kw})
        self.assertEqual(status, 201, body)
        return body

    def test_create_and_get(self):
        self.add("A-1", stock=7)
        status, body = call("GET", "/api/items/A-1")
        self.assertEqual((status, body["stock"], body["available"]), (200, 7, 7))
        self.assertEqual(call("GET", "/api/items/NOPE")[0], 404)

    def test_duplicate_sku(self):
        self.add("A-1")
        status, body = call("POST", "/api/items", {"sku": "A-1", "name": "x", "price_cents": 1})
        self.assertEqual((status, body["error"]["code"]), (409, "SKU_EXISTS"))

    def test_adjust(self):
        self.add("A-1", stock=5)
        self.assertEqual(call("POST", "/api/items/A-1/adjust", {"delta": 3})[1]["stock"], 8)
        status, body = call("POST", "/api/items/A-1/adjust", {"delta": -20})
        self.assertEqual((status, body["error"]["code"]), (409, "INSUFFICIENT_STOCK"))

    def test_reserve_and_commit(self):
        self.add("A-1", stock=10)
        status, r = call("POST", "/api/reservations", {"sku": "A-1", "qty": 4})
        self.assertEqual(status, 201)
        self.assertEqual(call("GET", "/api/items/A-1")[1]["available"], 6)
        self.assertEqual(call("POST", f"/api/reservations/{r['id']}/commit", {})[0], 200)
        self.assertEqual(call("GET", "/api/items/A-1")[1]["stock"], 6)

    def test_list_sorted_by_name(self):
        for sku, name in (("B", "Bravo"), ("A", "Alpha"), ("C", "Charlie")):
            call("POST", "/api/items", {"sku": sku, "name": name, "price_cents": 1, "stock": 1})
        status, body = call("GET", "/api/items?sort=name")
        self.assertEqual([i["sku"] for i in body["items"]], ["A", "B", "C"])

    def test_validation(self):
        self.assertEqual(call("POST", "/api/items", {"sku": "lower", "name": "x", "price_cents": 1})[0], 400)
        self.assertEqual(call("GET", "/api/items?limit=0")[0], 400)


if __name__ == "__main__":
    unittest.main()
