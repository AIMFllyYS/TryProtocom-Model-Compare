import json
import os
import unittest
import urllib.error
import urllib.request

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:8080").rstrip("/")


def call(method, path, body=None, token=None, data=None):
    headers = {}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw[:1] in (b"{", b"[") else raw)
    except urllib.error.HTTPError as e:
        raw = e.read()
        return e.code, (json.loads(raw) if raw[:1] in (b"{", b"[") else raw)


class NotesTest(unittest.TestCase):
    def setUp(self):
        self.assertIn(call("POST", "/api/__bench/reset", {})[0], (200, 204))

    def user(self, name):
        self.assertEqual(call("POST", "/api/register", {"username": name, "password": f"password-{name}"})[0], 201)
        status, body = call("POST", "/api/login", {"username": name, "password": f"password-{name}"})
        self.assertEqual(status, 200)
        return body["token"]

    def test_register_login_me(self):
        tok = self.user("alice")
        status, me = call("GET", "/api/me", token=tok)
        self.assertEqual((status, me["username"]), (200, "alice"))
        self.assertEqual(call("POST", "/api/login", {"username": "alice", "password": "nope-nope"})[0], 401)

    def test_notes_and_sharing(self):
        a, b = self.user("alice"), self.user("bob")
        status, note = call("POST", "/api/notes", {"title": "t", "body": "b"}, token=a)
        self.assertEqual(status, 201)
        self.assertEqual(call("POST", f"/api/notes/{note['id']}/share", {"username": "bob"}, token=a)[0], 200)
        self.assertEqual(call("GET", f"/api/notes/{note['id']}", token=b)[1]["body"], "b")
        self.assertEqual(call("DELETE", f"/api/notes/{note['id']}", token=a)[0], 204)

    def test_search(self):
        a = self.user("alice")
        call("POST", "/api/notes", {"title": "Groceries", "body": "milk"}, token=a)
        call("POST", "/api/notes", {"title": "Work", "body": "report"}, token=a)
        status, body = call("GET", "/api/notes/search?q=milk", token=a)
        self.assertEqual([n["title"] for n in body["notes"]], ["Groceries"])

    def test_files(self):
        a = self.user("alice")
        nid = call("POST", "/api/notes", {"title": "t", "body": "b"}, token=a)[1]["id"]
        self.assertEqual(call("PUT", f"/api/notes/{nid}/files/a.txt", data=b"hello", token=a)[0], 201)
        self.assertEqual(call("GET", f"/api/notes/{nid}/files/a.txt", token=a)[1], b"hello")

    def test_requires_login(self):
        self.assertEqual(call("GET", "/api/notes")[0], 401)


if __name__ == "__main__":
    unittest.main()
