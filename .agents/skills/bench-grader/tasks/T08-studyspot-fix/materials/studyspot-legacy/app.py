#!/usr/bin/env python3
"""StudySpot 自习室预约服务 v0.9（线上版本）。

仅用 Python 标准库：http.server + sqlite3。
运行：PORT=8080 DB_PATH=studyspot.db python app.py
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

TZ = timezone(timedelta(hours=8))  # Asia/Shanghai
OPEN_HOUR, CLOSE_HOUR = 8, 22
DAILY_LIMIT_HOURS = 4
CHECKIN_BEFORE_MIN, CHECKIN_AFTER_MIN = 10, 15
NO_SHOW_BAN_COUNT, NO_SHOW_LOOKBACK_DAYS, BAN_DAYS = 2, 30, 7

DB_PATH = os.environ.get("DB_PATH", "studyspot.db")
LOCK = threading.Lock()


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str = ""):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message or code


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with db() as c:
        c.executescript(
            """
            CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, student_id TEXT UNIQUE, name TEXT,
                pin_hash TEXT, salt TEXT);
            CREATE TABLE IF NOT EXISTS tokens(token TEXT PRIMARY KEY, user_id INTEGER);
            CREATE TABLE IF NOT EXISTS seats(id TEXT PRIMARY KEY, has_power INTEGER, status TEXT);
            CREATE TABLE IF NOT EXISTS bookings(id INTEGER PRIMARY KEY, user_id INTEGER, seat_id TEXT,
                date TEXT, start_hour INTEGER, end_hour INTEGER, status TEXT, checked_in_at TEXT);
            """
        )
        if c.execute("SELECT COUNT(*) FROM seats").fetchone()[0] == 0:
            for i in range(1, 21):
                sid = f"A{i:02d}"
                c.execute("INSERT INTO seats VALUES(?,?,?)", (sid, 1 if i <= 8 else 0, "closed" if i == 20 else "open"))


def hash_pin(pin: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", pin.encode(), salt.encode(), 100_000).hex()


def now_from(headers) -> datetime:
    raw = headers.get("X-Bench-Now")
    if raw:
        try:
            dt = datetime.fromisoformat(raw)
            return dt if dt.tzinfo else dt.replace(tzinfo=TZ)
        except ValueError:
            raise ApiError(400, "VALIDATION_ERROR", "bad X-Bench-Now")
    return datetime.now().astimezone()


def slot_start(date: str, hour: int) -> datetime:
    return datetime.fromisoformat(date).replace(hour=hour, tzinfo=TZ)


def effective_status(row, now: datetime) -> str:
    st = row["status"]
    if st == "active" and now > slot_start(row["date"], row["start_hour"]) + timedelta(minutes=CHECKIN_AFTER_MIN):
        return "no_show"
    return st


def booking_json(row, now: datetime) -> dict:
    return {"id": row["id"], "seat_id": row["seat_id"], "date": row["date"], "start_hour": row["start_hour"],
            "end_hour": row["end_hour"], "status": effective_status(row, now)}


def ban_until(c, user_id: int, now: datetime):
    rows = c.execute("SELECT * FROM bookings WHERE user_id=? AND status='active'", (user_id,)).fetchall()
    miss = sorted(slot_start(r["date"], r["start_hour"]) + timedelta(minutes=CHECKIN_AFTER_MIN)
                  for r in rows if effective_status(r, now) == "no_show")
    miss = [m for m in miss if m >= now - timedelta(days=NO_SHOW_LOOKBACK_DAYS)]
    if len(miss) >= NO_SHOW_BAN_COUNT:
        until = miss[NO_SHOW_BAN_COUNT - 1] + timedelta(days=BAN_DAYS)
        if now < until:
            return until
    return None


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):  # quiet
        pass

    # ---------- helpers ----------
    def send(self, status: int, body: dict) -> None:
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def body(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        if n == 0:
            return {}
        try:
            data = json.loads(self.rfile.read(n))
        except json.JSONDecodeError:
            raise ApiError(400, "VALIDATION_ERROR", "invalid json")
        if not isinstance(data, dict):
            raise ApiError(400, "VALIDATION_ERROR", "object expected")
        return data

    def user(self, c):
        auth = self.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            raise ApiError(401, "UNAUTHORIZED")
        row = c.execute("SELECT u.* FROM tokens t JOIN users u ON u.id=t.user_id WHERE t.token=?", (auth[7:],)).fetchone()
        if not row:
            raise ApiError(401, "UNAUTHORIZED")
        return row

    def dispatch(self, method: str) -> None:
        try:
            url = urlparse(self.path)
            path, qs = url.path.rstrip("/") or "/", parse_qs(url.query)
            now = now_from(self.headers)
            conn = db()
            try:
                status, body = self.route(conn, method, path, qs, now)
                conn.commit()
            finally:
                conn.close()
            self.send(status, body)
        except ApiError as e:
            self.send(e.status, {"error": {"code": e.code, "message": e.message}})
        except Exception as e:  # noqa: BLE001
            self.send(500, {"error": {"code": "INTERNAL", "message": str(e)}})

    def do_GET(self):
        self.dispatch("GET")

    def do_POST(self):
        self.dispatch("POST")

    def do_DELETE(self):
        self.dispatch("DELETE")

    # ---------- routes ----------
    def route(self, c, method, path, qs, now):
        if method == "GET" and path == "/health":
            return 200, {"ok": True}
        if method == "POST" and path == "/api/__bench/reset":
            if os.environ.get("BENCH_MODE") != "1":
                raise ApiError(404, "NOT_FOUND")
            c.executescript("DELETE FROM bookings; DELETE FROM tokens; DELETE FROM users;")
            return 200, {"ok": True}
        if method == "POST" and path == "/api/users":
            return self.register(c)
        if method == "POST" and path == "/api/sessions":
            return self.login(c)
        if method == "GET" and path == "/api/seats":
            rows = c.execute("SELECT * FROM seats ORDER BY id").fetchall()
            return 200, {"seats": [{"id": r["id"], "has_power": bool(r["has_power"]), "status": r["status"]} for r in rows]}
        if method == "GET" and path == "/api/availability":
            return self.availability(c, qs, now)
        if method == "POST" and path == "/api/bookings":
            return self.create_booking(c, now)
        if method == "GET" and path == "/api/bookings/me":
            u = self.user(c)
            rows = c.execute("SELECT * FROM bookings WHERE user_id=? ORDER BY date, start_hour, id", (u["id"],)).fetchall()
            return 200, {"bookings": [booking_json(r, now) for r in rows]}
        m = re.fullmatch(r"/api/bookings/(\d+)", path)
        if m and method == "DELETE":
            return self.cancel(c, int(m.group(1)), now)
        m = re.fullmatch(r"/api/bookings/(\d+)/checkin", path)
        if m and method == "POST":
            return self.checkin(c, int(m.group(1)), now)
        raise ApiError(404, "NOT_FOUND")

    def register(self, c):
        b = self.body()
        sid, name, pin = b.get("student_id"), b.get("name"), b.get("pin")
        if not (isinstance(sid, str) and re.fullmatch(r"\d{8,12}", sid)):
            raise ApiError(400, "VALIDATION_ERROR", "student_id must be 8-12 digits")
        if not (isinstance(name, str) and 1 <= len(name.strip()) <= 20):
            raise ApiError(400, "VALIDATION_ERROR", "name length 1-20")
        if not (isinstance(pin, str) and re.fullmatch(r"\d{4,6}", pin)):
            raise ApiError(400, "VALIDATION_ERROR", "pin must be 4-6 digits")
        if c.execute("SELECT 1 FROM users WHERE student_id=?", (sid,)).fetchone():
            raise ApiError(409, "DUPLICATE_STUDENT")
        salt = secrets.token_hex(8)
        cur = c.execute("INSERT INTO users(student_id,name,pin_hash,salt) VALUES(?,?,?,?)", (sid, name.strip(), hash_pin(pin, salt), salt))
        return 201, {"id": cur.lastrowid, "student_id": sid, "name": name.strip()}

    def login(self, c):
        b = self.body()
        row = c.execute("SELECT * FROM users WHERE student_id=?", (str(b.get("student_id")),)).fetchone()
        if not row or not isinstance(b.get("pin"), str) or hash_pin(b["pin"], row["salt"]) != row["pin_hash"]:
            raise ApiError(401, "UNAUTHORIZED")
        tok = secrets.token_urlsafe(24)
        c.execute("INSERT INTO tokens VALUES(?,?)", (tok, row["id"]))
        return 200, {"token": tok}

    @staticmethod
    def check_date(date, now: datetime) -> None:
        if not (isinstance(date, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", date)):
            raise ApiError(400, "VALIDATION_ERROR", "date format YYYY-MM-DD")
        try:
            d = datetime.fromisoformat(date).date()
        except ValueError:
            raise ApiError(400, "VALIDATION_ERROR", "invalid date")
        today = now.date()
        if d not in (today, today + timedelta(days=1)):
            raise ApiError(422, "OUT_OF_WINDOW")

    def availability(self, c, qs, now):
        date = (qs.get("date") or [None])[0]
        self.check_date(date, now)
        seats = c.execute("SELECT * FROM seats ORDER BY id").fetchall()
        out = []
        for s in seats:
            free = []
            if s["status"] == "open":
                rows = c.execute("SELECT * FROM bookings WHERE seat_id=? AND date=?", (s["id"], date)).fetchall()
                taken = set()
                for r in rows:
                    if effective_status(r, now) in ("active", "checked_in"):
                        taken.update(range(r["start_hour"], r["end_hour"]))
                free = [h for h in range(OPEN_HOUR, CLOSE_HOUR) if h not in taken]
            out.append({"id": s["id"], "free_hours": free})
        return 200, {"date": date, "seats": out}

    def create_booking(self, c, now):
        u = self.user(c)
        b = self.body()
        seat_id, date, sh, eh = b.get("seat_id"), b.get("date"), b.get("start_hour"), b.get("end_hour")
        if not isinstance(seat_id, str) or not all(isinstance(x, int) and not isinstance(x, bool) for x in (sh, eh)):
            raise ApiError(400, "VALIDATION_ERROR", "seat_id str, start_hour/end_hour int")
        self.check_date(date, now)
        seat = c.execute("SELECT * FROM seats WHERE id=?", (seat_id,)).fetchone()
        if not seat:
            raise ApiError(404, "NOT_FOUND", "seat")
        if not (OPEN_HOUR <= sh < eh <= CLOSE_HOUR):
            raise ApiError(422, "OUT_OF_HOURS")
        if slot_start(date, sh) < now:
            raise ApiError(422, "PAST_SLOT")
        if ban_until(c, u["id"], now):
            raise ApiError(403, "BANNED")
        if seat["status"] != "open":
            raise ApiError(409, "SEAT_UNAVAILABLE")
        same_day = [r for r in c.execute("SELECT * FROM bookings WHERE date=?", (date,)).fetchall()
                    if effective_status(r, now) in ("active", "checked_in")]
        for r in same_day:
            if r["seat_id"] == seat_id and r["start_hour"] <= eh and sh <= r["end_hour"]:
                raise ApiError(409, "SLOT_CONFLICT")
        mine_all = [r for r in c.execute("SELECT * FROM bookings WHERE date=? AND user_id=?", (date, u["id"])).fetchall()]
        mine = [r for r in same_day if r["user_id"] == u["id"]]
        for r in mine:
            if r["start_hour"] < eh and sh < r["end_hour"]:
                raise ApiError(409, "USER_OVERLAP")
        if sum(r["end_hour"] - r["start_hour"] for r in mine_all) + (eh - sh) > DAILY_LIMIT_HOURS:
            raise ApiError(422, "DAILY_LIMIT")
        cur = c.execute("INSERT INTO bookings(user_id,seat_id,date,start_hour,end_hour,status) VALUES(?,?,?,?,?,'active')",
                        (u["id"], seat_id, date, sh, eh))
        row = c.execute("SELECT * FROM bookings WHERE id=?", (cur.lastrowid,)).fetchone()
        return 201, booking_json(row, now)

    def owned(self, c, bid):
        u = self.user(c)
        row = c.execute("SELECT * FROM bookings WHERE id=?", (bid,)).fetchone()
        if not row:
            raise ApiError(404, "NOT_FOUND")
        if row["user_id"] != u["id"]:
            raise ApiError(403, "FORBIDDEN")
        return row

    def cancel(self, c, bid, now):
        self.user(c)
        row = c.execute("SELECT * FROM bookings WHERE id=?", (bid,)).fetchone()
        if not row:
            raise ApiError(404, "NOT_FOUND")
        if row["status"] == "cancelled":
            raise ApiError(409, "ALREADY_CANCELLED")
        if now >= slot_start(row["date"], row["start_hour"]):
            raise ApiError(422, "CANCEL_TOO_LATE")
        c.execute("UPDATE bookings SET status='cancelled' WHERE id=?", (bid,))
        return 200, booking_json(c.execute("SELECT * FROM bookings WHERE id=?", (bid,)).fetchone(), now)

    def checkin(self, c, bid, now):
        row = self.owned(c, bid)
        start = slot_start(row["date"], row["start_hour"])
        if row["status"] != "active" or not (start - timedelta(minutes=CHECKIN_BEFORE_MIN) <= now <= start + timedelta(minutes=CHECKIN_AFTER_MIN)):
            raise ApiError(422, "CHECKIN_WINDOW")
        c.execute("UPDATE bookings SET status='checked_in', checked_in_at=? WHERE id=?", (now.isoformat(), bid))
        return 200, booking_json(c.execute("SELECT * FROM bookings WHERE id=?", (bid,)).fetchone(), now)


def main() -> None:
    init_db()
    port = int(os.environ.get("PORT", "8080"))
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"StudySpot listening on {port}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
