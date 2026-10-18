"""回归测试：用量日志扫描的“有界窗口预判 + 解析缓存”必须只改性能、不改结果。

背景（2026-10-18）：一次自动评分以 `bridge snapshot 超时` 失败。原因是 snapshot 会为全部 140 个
运行重新解析 harness 日志（实测 8360 次文件打开 / 393 GB，一次 snapshot 715.6s > 600s 桥接超时）。
修复引入两道闸：① mtime 之外的“首/中/尾时间戳采样”预判；② 按 (文件,窗口,工作区) 记忆解析结果。

本测试锁定两条不变量：
  - 预判只允许在“证据充分且确实在窗口之外”时跳过；窗口内/信息不足时一定要解析。
  - 缓存命中与未命中必须返回完全相同的结果，且同一文件同一窗口只解析一次。

运行：python -m pytest scripts/tests -q（在 bench-grader 目录下）
"""
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from benchlib import usage  # noqa: E402

UTC = timezone.utc


def _claude_line(ts: str, cwd: str, i: int = 0) -> str:
    return json.dumps({"timestamp": ts, "type": "assistant", "cwd": cwd,
                       "message": {"id": f"m{i}", "model": "test-model",
                                   "usage": {"input_tokens": 100, "output_tokens": 10}}}) + "\n"


def _write_session(path: Path, start: datetime, minutes: int, cwd: str) -> Path:
    """写一个“单次会话”的 jsonl：时间戳单调递增，首尾即最小/最大时间。"""
    with path.open("w", encoding="utf-8") as f:
        for i in range(minutes):
            t = (start + timedelta(minutes=i)).isoformat().replace("+00:00", "Z")
            f.write(_claude_line(t, cwd, i))
    return path


def test_window_probe_keeps_files_inside_the_window(tmp_path):
    """窗口内的会话必须判定为“可能命中”，不能被预判跳过。"""
    ws = str(tmp_path / "ws")
    Path(ws).mkdir()
    start = datetime(2026, 10, 17, 11, 0, tzinfo=UTC)
    end = start + timedelta(minutes=30)
    f = _write_session(tmp_path / "inside.jsonl", start + timedelta(minutes=5), 20, ws)
    assert usage._may_hit_window(f, start, end) is True


def test_window_probe_skips_files_provably_outside_the_window(tmp_path):
    """完全早于窗口（历史会话）和完全晚于窗口（别的会话）都应被跳过。"""
    start = datetime(2026, 10, 17, 11, 0, tzinfo=UTC)
    end = start + timedelta(minutes=30)
    old = _write_session(tmp_path / "old.jsonl", start - timedelta(days=3), 20, "D:/other")
    new = _write_session(tmp_path / "new.jsonl", end + timedelta(hours=6), 20, "D:/other")
    assert usage._may_hit_window(old, start, end) is False
    assert usage._may_hit_window(new, start, end) is False


def test_window_probe_is_conservative_without_timestamps(tmp_path):
    """拿不到时间戳时不许跳过（宁可多解析，不能漏算用量）。"""
    start = datetime(2026, 10, 17, 11, 0, tzinfo=UTC)
    end = start + timedelta(minutes=30)
    f = tmp_path / "junk.jsonl"
    f.write_text("no timestamps here\n" * 50, encoding="utf-8")
    assert usage._may_hit_window(f, start, end) is True


def test_window_probe_is_conservative_without_a_window(tmp_path):
    """没有窗口信息时全部保留。"""
    f = _write_session(tmp_path / "s.jsonl", datetime(2020, 1, 1, tzinfo=UTC), 5, "D:/x")
    assert usage._may_hit_window(f, None, None) is True


def test_cache_returns_identical_results_and_parses_once(tmp_path, monkeypatch):
    """缓存命中/未命中结果必须一致，且同一 (文件,窗口,工作区) 只真正解析一次。"""
    ws = str(tmp_path / "ws")
    Path(ws).mkdir()
    start = datetime(2026, 10, 17, 11, 0, tzinfo=UTC)
    end = start + timedelta(minutes=40)
    f = _write_session(tmp_path / "s.jsonl", start + timedelta(minutes=1), 30, ws)

    calls = {"n": 0}
    real = usage.parse_claude_file

    def counting(path, workspace=None, s=None, e=None):
        calls["n"] += 1
        return real(path, workspace, s, e)

    # 隔离：用临时缓存文件，避免污染真实用户的缓存
    monkeypatch.setattr(usage, "_cache_path", lambda: tmp_path / "cache.json")
    monkeypatch.setattr(usage, "_CACHE_DISK", None)
    monkeypatch.setattr(usage, "_CACHE_DIRTY", False)

    first = usage._cached_parse(counting, f, ws, start, end, "parse_claude_file")
    usage.save_cache()
    assert calls["n"] == 1
    assert first and first["wall_min"] == 29.0 and first["input_tokens"] == 3000

    # 模拟“下一次 snapshot”：新进程 => 重新从磁盘读缓存
    monkeypatch.setattr(usage, "_CACHE_DISK", None)
    second = usage._cached_parse(counting, f, ws, start, end, "parse_claude_file")
    assert calls["n"] == 1, "第二次必须命中磁盘缓存，不能重新解析"
    assert second == first


def test_cache_key_varies_with_window(tmp_path, monkeypatch):
    """不同窗口不能共用缓存条目，否则会把别的运行的用量算进来。"""
    ws = str(tmp_path / "ws")
    Path(ws).mkdir()
    f = _write_session(tmp_path / "s.jsonl", datetime(2026, 10, 17, 11, 0, tzinfo=UTC), 60, ws)
    a = usage._cache_key("p", f, ws, datetime(2026, 10, 17, 11, 0, tzinfo=UTC), datetime(2026, 10, 17, 11, 30, tzinfo=UTC))
    b = usage._cache_key("p", f, ws, datetime(2026, 10, 17, 11, 0, tzinfo=UTC), datetime(2026, 10, 17, 12, 30, tzinfo=UTC))
    c = usage._cache_key("p", f, str(tmp_path / "other"), datetime(2026, 10, 17, 11, 0, tzinfo=UTC), datetime(2026, 10, 17, 11, 30, tzinfo=UTC))
    assert len({a, b, c}) == 3
