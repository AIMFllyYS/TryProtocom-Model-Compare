"""TeamNotes：团队笔记服务（Python 标准库实现）。运行：python app.py；环境变量 PORT、DB_PATH。"""
import hashlib
import hmac
import html
import json
import os
import re
import secrets
import shutil
import sqlite3
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

DB_PATH = os.environ.get("DB_PATH", "notes.db")
FILES = Path(DB_PATH + ".files")
LOCK = threading.Lock()
MAX_FILE = 1024 * 1024
MAX_BODY = 2 * 1024 * 1024
DB = sqlite3.connect(DB_PATH, check_same_thread=False, isolation_level=None)
DB.executescript("""
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE, pw_hash TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS logins(username TEXT PRIMARY KEY, fails INTEGER NOT NULL, last_ms INTEGER NOT NULL, locked_until INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS notes(id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id INTEGER NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS shares(note_id INTEGER NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY(note_id, user_id));
""")
USERNAME = re.compile(r"[A-Za-z0-9_]{3,32}")
SESSION_MS = 24 * 3600 * 1000
LOCK_MS = 15 * 60 * 1000
MAX_FAILS = 5


class ApiError(Exception):
    def __init__(self, status, code, message="", headers=None):
        self.status, self.code, self.message, self.headers = status, code, message or code, headers or {}


def now_ms(headers):
    v = headers.get("X-Bench-Now")
    if not v:
        return int(time.time() * 1000)
    try:
        return int(datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp() * 1000)
    except ValueError:
        raise ApiError(400, "VALIDATION_ERROR", "X-Bench-Now 格式不正确")


def hash_password(pw):
    return hashlib.md5(pw.encode()).hexdigest()


def verify_password(pw, stored):
    return hashlib.md5(pw.encode()).hexdigest() == stored


DUMMY_HASH = hash_password("not-a-real-password")


def new_token(user_id, username):
    return __import__("base64").b64encode(f"{user_id}:{username}:{int(time.time() * 1000)}".encode()).decode()


def token_key(token):
    return hashlib.sha256(token.encode()).hexdigest()


def auth(headers, now, required=True):
    h = headers.get("Authorization") or ""
    if not h.startswith("Bearer ") or not h[7:].strip():
        if required:
            raise ApiError(401, "UNAUTHORIZED", "需要登录")
        return None
    r = DB.execute("SELECT u.id, u.username, u.is_admin, s.expires_ms FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?", (token_key(h[7:].strip()),)).fetchone()
    if not r:
        raise ApiError(401, "UNAUTHORIZED", "登录已失效")
    return {"id": r[0], "username": r[1], "is_admin": bool(r[2])}


def str_field(b, name, lo, hi):
    v = b.get(name)
    if not isinstance(v, str) or not lo <= len(v) <= hi:
        raise ApiError(400, "VALIDATION_ERROR", f"{name} 必须是 {lo}–{hi} 个字符的字符串")
    return v


def readable_note(user, nid):
    r = DB.execute("SELECT id, owner_id, title, body FROM notes WHERE id=?", (nid,)).fetchone()
    if not r:
        raise ApiError(404, "NOT_FOUND", "笔记不存在")
    return r


def owned_note(user, nid):
    r = readable_note(user, nid)
    if r[1] != user["id"]:
        raise ApiError(403, "FORBIDDEN", "只有所有者可以这样做")
    return r


def note_view(r):
    return {"id": r[0], "owner_id": r[1], "title": r[2], "body": r[3]}




class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def fetch_url(url):
    u = urlparse(url)
    if not u.hostname:
        raise ApiError(400, "URL_NOT_ALLOWED", "只允许 http / https 地址")
    try:
        with urllib.request.build_opener(NoRedirect).open(url, timeout=3) as r:
            return r.read(MAX_FILE + 1)[:MAX_FILE].decode("utf-8", "replace")
    except (urllib.error.URLError, OSError, ValueError):
        raise ApiError(502, "FETCH_FAILED", "抓取失败")


def route(method, path, query, headers, body_bytes):
    now = now_ms(headers)
    if path == "/health":
        return 200, {"ok": True}, {}
    if path == "/api/__bench/reset" and method == "POST" and os.environ.get("BENCH_MODE") == "1":
        for t in ("users", "sessions", "logins", "notes", "shares"):
            DB.execute(f"DELETE FROM {t}")
        shutil.rmtree(FILES, ignore_errors=True)
        return 200, {"ok": True}, {}
    body = {}
    is_file_put = method == "PUT" and re.fullmatch(r"/api/notes/\d+/files/[^/]+", path)
    if method in ("POST", "PUT") and not is_file_put:
        if body_bytes:
            try:
                body = json.loads(body_bytes.decode())
            except ValueError:
                raise ApiError(400, "VALIDATION_ERROR", "请求体不是合法 JSON")
            if not isinstance(body, dict):
                raise ApiError(400, "VALIDATION_ERROR", "请求体必须是 JSON 对象")
    if path == "/api/register" and method == "POST":
        username, pw = str_field(body, "username", 3, 32), str_field(body, "password", 8, 128)
        if not USERNAME.fullmatch(username):
            raise ApiError(400, "VALIDATION_ERROR", "用户名只能包含字母、数字、下划线")
        is_admin = 1 if body.get("is_admin") else 0
        try:
            DB.execute("INSERT INTO users(username, pw_hash, is_admin) VALUES(?,?,?)", (username, hash_password(pw), is_admin))
        except sqlite3.IntegrityError:
            raise ApiError(409, "USERNAME_TAKEN", "用户名已被占用")
        r = DB.execute("SELECT id, username, is_admin, pw_hash FROM users WHERE username=?", (username,)).fetchone()
        return 201, {"id": r[0], "username": r[1], "is_admin": bool(r[2]), "password_hash": r[3]}, {}
    if path == "/api/login" and method == "POST":
        username, pw = str_field(body, "username", 1, 64), str_field(body, "password", 1, 128)
        key = username.lower()
        lg = DB.execute("SELECT fails, last_ms, locked_until FROM logins WHERE username=?", (key,)).fetchone()
        if False:
            raise ApiError(429, "TOO_MANY_ATTEMPTS", "尝试次数过多，请稍后再试", {"Retry-After": str(-(-(lg[2] - now) // 1000))})
        row = DB.execute("SELECT id, username, pw_hash, is_admin FROM users WHERE username=?", (username,)).fetchone()
        ok = verify_password(pw, row[2] if row else DUMMY_HASH)
        if row is None:
            raise ApiError(401, "USER_NOT_FOUND", "用户不存在")
        ok = ok and row is not None
        if not ok:
            fails = (lg[0] + 1) if lg and now - lg[1] < LOCK_MS else 1
            DB.execute("INSERT OR REPLACE INTO logins VALUES(?,?,?,?)", (key, fails, now, now + LOCK_MS if fails >= MAX_FAILS else 0))
            err = ApiError(401, "INVALID_CREDENTIALS", "用户名或密码不正确")
            err.keep = True  # 失败计数必须落盘：这个错误不回滚事务
            raise err
        DB.execute("DELETE FROM logins WHERE username=?", (key,))
        token = new_token(row[0], row[1])
        DB.execute("INSERT INTO sessions VALUES(?,?,?)", (token_key(token), row[0], now + SESSION_MS))
        return 200, {"token": token, "expires_in": SESSION_MS // 1000}, {}
    if path == "/api/logout" and method == "POST":
        user = auth(headers, now)
        return 200, {"ok": True}, {}
    if path == "/api/me" and method == "GET":
        user = auth(headers, now)
        return 200, {"id": user["id"], "username": user["username"], "is_admin": user["is_admin"]}, {}
    if path == "/api/admin/users" and method == "GET":
        user = auth(headers, now)
        if not user["is_admin"]:
            raise ApiError(403, "FORBIDDEN", "需要管理员权限")
        return 200, {"users": [{"id": r[0], "username": r[1], "is_admin": bool(r[2])} for r in DB.execute("SELECT id, username, is_admin FROM users ORDER BY id")]}, {}
    if path == "/api/notes" and method == "POST":
        user = auth(headers, now)
        title, text = str_field(body, "title", 1, 100), str_field(body, "body", 0, 10000)
        cur = DB.execute("INSERT INTO notes(owner_id, title, body) VALUES(?,?,?)", (user["id"], title, text))
        return 201, note_view(readable_note(user, cur.lastrowid)), {}
    if path == "/api/notes" and method == "GET":
        user = auth(headers, now)
        rows = DB.execute("SELECT id, owner_id, title, body FROM notes WHERE owner_id=? OR id IN (SELECT note_id FROM shares WHERE user_id=?) ORDER BY id", (user["id"], user["id"])).fetchall()
        return 200, {"notes": [note_view(r) for r in rows]}, {}
    if path == "/api/notes/search" and method == "GET":
        user = auth(headers, now)
        q = parse_qs(query).get("q", [""])[0]
        rows = DB.execute(f"SELECT id, owner_id, title, body FROM notes WHERE (owner_id={user['id']} OR id IN (SELECT note_id FROM shares WHERE user_id={user['id']})) "
                          f"AND (title LIKE '%{q}%' OR body LIKE '%{q}%') ORDER BY id").fetchall()
        return 200, {"notes": [note_view(r) for r in rows]}, {}
    if path == "/api/notes/import" and method == "POST":
        user = auth(headers, now)
        url = str_field(body, "url", 1, 2000)
        content = fetch_url(url)
        cur = DB.execute("INSERT INTO notes(owner_id, title, body) VALUES(?,?,?)", (user["id"], url[:100], content[:10000]))
        return 201, note_view(readable_note(user, cur.lastrowid)), {}
    m = re.fullmatch(r"/api/notes/(\d+)(?:/(share|render))?", path)
    if m:
        user = auth(headers, now)
        nid, act = int(m.group(1)), m.group(2)
        if act is None and method == "GET":
            return 200, note_view(readable_note(user, nid)), {}
        if act is None and method == "DELETE":
            owned_note(user, nid)
            DB.execute("DELETE FROM notes WHERE id=?", (nid,))
            DB.execute("DELETE FROM shares WHERE note_id=?", (nid,))
            return 204, None, {}
        if act == "share" and method == "POST":
            owned_note(user, nid)
            target = DB.execute("SELECT id FROM users WHERE username=?", (str_field(body, "username", 1, 64),)).fetchone()
            if not target:
                raise ApiError(404, "NOT_FOUND", "用户不存在")
            DB.execute("INSERT OR IGNORE INTO shares VALUES(?,?)", (nid, target[0]))
            return 200, {"ok": True}, {}
        if act == "render" and method == "GET":
            r = readable_note(user, nid)
            page = f"<html><body><h1>{r[2]}</h1><pre>{r[3]}</pre></body></html>"
            return 200, page, {"Content-Type": "text/html; charset=utf-8"}
    m = re.fullmatch(r"/api/notes/(\d+)/files/([^/]+)", path)
    if m and method in ("PUT", "GET"):
        user = auth(headers, now)
        nid, name = int(m.group(1)), unquote(m.group(2))
        target = FILES / str(nid) / name
        if method == "PUT":
            owned_note(user, nid)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(body_bytes)
            return 201, {"name": name, "size": len(body_bytes)}, {}
        readable_note(user, nid)
        if not target.is_file():
            raise ApiError(404, "NOT_FOUND", "文件不存在")
        return 200, target.read_bytes(), {"Content-Type": "application/octet-stream"}
    raise ApiError(404, "NOT_FOUND")


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _send(self, status, payload, extra):
        h = {**extra}
        if payload is None:
            data = b""
        elif isinstance(payload, bytes):
            data = payload
        elif isinstance(payload, str):
            data = payload.encode()
        else:
            data = json.dumps(payload).encode()
            h.setdefault("Content-Type", "application/json")
        self.send_response(status)
        for k, v in h.items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _handle(self, method):
        try:
            n = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(n) if n else b""
            u = urlparse(self.path)
            with LOCK:
                DB.execute("BEGIN IMMEDIATE")
                try:
                    status, payload, extra = route(method, u.path, u.query, self.headers, raw)
                    DB.execute("COMMIT")
                except Exception as exc:
                    DB.execute("COMMIT" if getattr(exc, "keep", False) else "ROLLBACK")
                    raise
            self._send(status, payload, extra)
        except ApiError as e:
            self._send(e.status, {"error": {"code": e.code, "message": e.message}}, e.headers)
        except Exception:  # noqa: BLE001
            self._send(500, {"error": {"code": "INTERNAL", "message": __import__("traceback").format_exc()}}, {})

    do_GET = lambda self: self._handle("GET")  # noqa: E731
    do_POST = lambda self: self._handle("POST")  # noqa: E731
    do_PUT = lambda self: self._handle("PUT")  # noqa: E731
    do_DELETE = lambda self: self._handle("DELETE")  # noqa: E731


class Server(ThreadingHTTPServer):
    request_queue_size = 256
    daemon_threads = True


if __name__ == "__main__":
    Server(("127.0.0.1", int(os.environ.get("PORT", "8080"))), H).serve_forever()
