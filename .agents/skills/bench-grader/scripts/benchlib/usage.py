"""用时与成本：用户提供 > 本地 harness 日志解析 > 列入“需用户补充”。

支持的日志（尽力解析，格式可能随版本变化）：
  Claude Code : ~/.claude/projects/<项目>/<session>.jsonl（assistant 消息带 usage，条目带 cwd 与 timestamp）
  Codex CLI   : ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl（session_meta.cwd，token_count.total_token_usage）
  Gemini CLI  : ~/.gemini/tmp/**/（JSON 中带 tokens / usageMetadata 的条目）
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .common import CONFIG_DIR, load_yaml

USER_FIELDS = ["wall_min", "active_min", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "cost_usd"]


def _ts(s) -> datetime | None:
    if not s:
        return None
    try:
        if isinstance(s, (int, float)):
            return datetime.fromtimestamp(s / 1000 if s > 1e12 else s, tz=timezone.utc)
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except ValueError:
        return None


def _in_window(t: datetime | None, start: datetime | None, end: datetime | None) -> bool:
    if t is None:
        return False
    if start and t < start:
        return False
    if end and t > end:
        return False
    return True


def _same_dir(a: str | None, b: str | None) -> bool:
    if not a or not b:
        return False
    a, b = str(Path(a).expanduser()).rstrip("/"), str(Path(b).expanduser()).rstrip("/")
    return a == b or a.startswith(b + "/") or b.startswith(a + "/")


# ---------------- Claude Code ----------------
def parse_claude_file(path: Path, workspace=None, start=None, end=None) -> dict | None:
    msgs, times, human_gaps, cwd_hit, model = {}, [], 0.0, workspace is None, None
    prev_t = None
    for line in path.open(encoding="utf-8", errors="replace"):
        try:
            d = json.loads(line)
        except json.JSONDecodeError:
            continue
        t = _ts(d.get("timestamp"))
        if (start or end) and not _in_window(t, start, end):
            continue
        if workspace and _same_dir(d.get("cwd"), workspace):
            cwd_hit = True
        if t:
            if d.get("type") == "user" and prev_t:
                content = (d.get("message") or {}).get("content")
                is_tool = isinstance(content, list) and any(isinstance(c, dict) and c.get("type") == "tool_result" for c in content)
                if not is_tool and not d.get("isMeta") and times:
                    human_gaps += (t - prev_t).total_seconds()
            times.append(t)
            prev_t = t
        if d.get("type") == "assistant":
            m = d.get("message") or {}
            u = m.get("usage")
            model = m.get("model") or model
            if u:
                key = m.get("id") or d.get("uuid")
                old = msgs.get(key)
                if not old or (u.get("output_tokens") or 0) >= (old.get("output_tokens") or 0):
                    msgs[key] = u
    if not cwd_hit or not times:
        return None
    tot = {"input_tokens": 0, "output_tokens": 0, "cache_read_tokens": 0, "cache_write_tokens": 0}
    for u in msgs.values():
        tot["input_tokens"] += u.get("input_tokens") or 0
        tot["output_tokens"] += u.get("output_tokens") or 0
        tot["cache_read_tokens"] += u.get("cache_read_input_tokens") or 0
        tot["cache_write_tokens"] += u.get("cache_creation_input_tokens") or 0
    wall = (max(times) - min(times)).total_seconds() / 60
    return {**tot, "wall_min": round(wall, 2), "active_min": round(max(wall - human_gaps / 60, 0), 2),
            "model": model, "source": "claude_code", "files": [str(path)], "has_usage": bool(msgs)}


# ---------------- Codex ----------------
# Codex 每行形如 {"timestamp":"...","type":...,"payload":{...}}；大多数行是工具输出（可达数 MB），
# 只需要时间戳。不含 cwd/model/token_count 的行用正则取时间戳，跳过 json.loads，结果与完整解析一致。
_CODEX_TS = re.compile(r'^\{"timestamp":"([^"]+)"')
_CODEX_KEYS = ('"cwd"', '"model"', '"token_count"')


def parse_codex_file(path: Path, workspace=None, start=None, end=None) -> dict | None:
    cwd_hit, times, last, model = workspace is None, [], None, None
    for line in path.open(encoding="utf-8", errors="replace"):
        m = _CODEX_TS.match(line)
        if m and not any(k in line for k in _CODEX_KEYS):
            t = _ts(m.group(1))
            if t and (not (start or end) or _in_window(t, start, end)):
                times.append(t)
            continue
        try:
            d = json.loads(line)
        except json.JSONDecodeError:
            continue
        t = _ts(d.get("timestamp"))
        if t:
            if (start or end) and not _in_window(t, start, end):
                continue
            times.append(t)
        p = d.get("payload") or {}
        if workspace and (_same_dir(p.get("cwd"), workspace) or _same_dir(d.get("cwd"), workspace)):
            cwd_hit = True
        model = p.get("model") or model
        if p.get("type") == "token_count":
            info = p.get("info") or {}
            last = info.get("total_token_usage") or last
    if not cwd_hit or not times:
        return None
    last = last or {}
    inp, cached = last.get("input_tokens") or 0, last.get("cached_input_tokens") or 0
    wall = (max(times) - min(times)).total_seconds() / 60
    return {"input_tokens": max(inp - cached, 0), "cache_read_tokens": cached, "cache_write_tokens": 0,
            "output_tokens": last.get("output_tokens") or 0, "reasoning_tokens": last.get("reasoning_output_tokens") or 0,
            "wall_min": round(wall, 2), "active_min": round(wall, 2), "model": model, "source": "codex", "files": [str(path)],
            "has_usage": bool(last)}


# ---------------- Gemini CLI（尽力） ----------------
def parse_gemini_file(path: Path, workspace=None, start=None, end=None) -> dict | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
    except (json.JSONDecodeError, OSError):
        return None
    tot = {"input_tokens": 0, "output_tokens": 0, "cache_read_tokens": 0, "cache_write_tokens": 0}
    times, model, hit = [], None, workspace is None

    def walk(o):
        nonlocal model, hit
        if isinstance(o, dict):
            t = _ts(o.get("timestamp"))
            if t:
                times.append(t)
            if workspace and any(_same_dir(o.get(k), workspace) for k in ("cwd", "projectRoot", "workingDirectory")):
                hit = True
            model = o.get("model") or model
            tk = o.get("tokens") or o.get("usageMetadata")
            if isinstance(tk, dict):
                tot["input_tokens"] += tk.get("input") or tk.get("promptTokenCount") or 0
                tot["output_tokens"] += (tk.get("output") or tk.get("candidatesTokenCount") or 0) + (tk.get("thoughts") or tk.get("thoughtsTokenCount") or 0)
                tot["cache_read_tokens"] += tk.get("cached") or tk.get("cachedContentTokenCount") or 0
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(data)
    if (start or end):
        times = [t for t in times if _in_window(t, start, end)]
    if not hit or not times:
        return None
    tot["input_tokens"] = max(tot["input_tokens"] - tot["cache_read_tokens"], 0)
    wall = (max(times) - min(times)).total_seconds() / 60
    return {**tot, "wall_min": round(wall, 2), "active_min": round(wall, 2), "model": model, "source": "gemini_cli",
            "files": [str(path)], "has_usage": any(tot.values())}


def _merge(parts: list[dict]) -> dict:
    out = {"input_tokens": 0, "output_tokens": 0, "cache_read_tokens": 0, "cache_write_tokens": 0, "wall_min": 0.0, "active_min": 0.0, "files": []}
    for p in parts:
        for k in ("input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "wall_min", "active_min"):
            out[k] += p.get(k) or 0
        out["files"] += p.get("files", [])
    out["source"] = parts[0]["source"]
    out["model"] = next((p.get("model") for p in parts if p.get("model")), None)
    out["has_usage"] = any(p.get("has_usage") for p in parts)
    return out


def scan_logs(meta: dict, cfg: dict) -> dict | None:
    roots = (cfg.get("external") or {}).get("log_roots") or {}
    ws = meta.get("workspace")
    start, end = _ts(meta.get("started_at")), _ts(meta.get("ended_at"))
    explicit = meta.get("log_path")
    candidates = []
    if explicit:
        for p in (explicit if isinstance(explicit, list) else [explicit]):
            p = Path(p).expanduser()
            files = [p] if p.is_file() else list(p.rglob("*.json*"))
            for f in files:
                parser = parse_codex_file if "rollout" in f.name else parse_gemini_file if f.suffix == ".json" else parse_claude_file
                r = parser(f, None, start, end)
                if r:
                    candidates.append(r)
        return _merge(candidates) if candidates else None
    if not ws and not (start and end):
        return None
    harness = (meta.get("harness") or "").lower()
    plan = [("claude_code", parse_claude_file, "*.jsonl"), ("codex", parse_codex_file, "rollout-*.jsonl"), ("gemini_cli", parse_gemini_file, "*.json")]
    wanted = [k for k, word in (("claude_code", "claude"), ("codex", "codex"), ("gemini_cli", "gemini")) if word in harness]
    for key, parser, pattern in plan:
        if wanted and key not in wanted:
            continue
        root = Path(roots.get(key) or {"claude_code": "~/.claude/projects", "codex": "~/.codex/sessions", "gemini_cli": "~/.gemini/tmp"}[key]).expanduser()
        if not root.exists():
            continue
        # 日志只追加：最后修改早于运行开始（留 10 分钟时钟余量）的文件不可能含窗口内条目，直接跳过，
        # 避免每次计分都把几 GB 的历史会话日志全部读一遍。
        floor = (start - timedelta(minutes=10)).timestamp() if start else None
        for f in root.rglob(pattern):
            if floor is not None:
                try:
                    if f.stat().st_mtime < floor:
                        continue
                except OSError:
                    continue
            r = parser(f, ws, start, end)
            if r:
                candidates.append(r)
        if candidates:
            return _merge(candidates)
    return None


def prices() -> dict:
    return load_yaml(CONFIG_DIR / "prices.yaml") or {}


def price_for(model: str | None, table: dict) -> dict | None:
    if not model:
        return None
    models = (table.get("models") or {})
    hits = [k for k in models if k.lower() in model.lower()]
    return models[max(hits, key=len)] if hits else None


def compute_cost(u: dict, model: str | None, table: dict) -> float | None:
    p = price_for(model, table)
    if not p:
        return None
    return round((u.get("input_tokens", 0) * p.get("input", 0) + u.get("output_tokens", 0) * p.get("output", 0)
                  + u.get("cache_read_tokens", 0) * p.get("cache_read", p.get("input", 0))
                  + u.get("cache_write_tokens", 0) * p.get("cache_write", p.get("input", 0))) / 1e6, 4)


def resolve_usage(meta: dict, cfg: dict) -> dict:
    """返回最终用量记录，并标注来源；缺失字段列在 missing 中。"""
    table = prices()
    user = meta.get("usage") or {}
    out = {k: user.get(k) for k in USER_FIELDS if user.get(k) not in (None, "")}
    src = "user" if out else None
    if "wall_min" not in out or ("cost_usd" not in out and "input_tokens" not in out):
        log = scan_logs(meta, cfg)
        if log:
            for k in ("wall_min", "active_min", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens"):
                if k not in out and log.get(k) is not None and (log.get("has_usage") or k in ("wall_min", "active_min")):
                    out[k] = log[k]
            out["log_files"] = log.get("files", [])[:5]
            out["log_model"] = log.get("model")
            src = f"{src}+{log['source']}" if src else log["source"]
    if "cost_usd" not in out and "input_tokens" in out:
        c = compute_cost(out, meta.get("model") or out.get("log_model"), table)
        if c is not None:
            out["cost_usd"] = c
            out["cost_estimated"] = True
            out["price_as_of"] = table.get("as_of")
    out["source"] = src or "none"
    out["missing"] = [k for k in ("wall_min", "cost_usd") if k not in out]
    return out
