"""公共工具：路径、配置、运行上下文、指标存储。"""
from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import time
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

SKILL_ROOT = Path(__file__).resolve().parents[2]
TASKS_DIR = SKILL_ROOT / "tasks"
CONFIG_DIR = SKILL_ROOT / "config"


def load_yaml(path: Path) -> Any:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_json(path: Path, default=None):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def dump_json(path: Path, data) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    # Readers must see either the old or new complete JSON, never a partial write.
    fd, tmp = tempfile.mkstemp(prefix=path.name+'.', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2, default=str)
        for attempt in range(100):
            try:
                os.replace(tmp, path)
                break
            except PermissionError:
                if attempt == 99:
                    raise
                time.sleep(.02)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


@contextmanager
def file_lock(path: Path):
    """Serialize a read-modify-write across independent evaluator processes."""
    path = Path(path)
    with path.open('a+b') as f:
        if os.name == 'nt':
            import msvcrt
            deadline = time.monotonic() + 120
            while True:
                try:
                    f.seek(0); msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
                    break
                except OSError:
                    if time.monotonic() >= deadline:
                        raise TimeoutError(f'Evaluator score lock busy: {path}')
                    time.sleep(.02)
            try:
                yield
            finally:
                f.seek(0); msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(f.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(f.fileno(), fcntl.LOCK_UN)


def bench_config() -> dict:
    """读取 config/benchmark.yaml；外部路径可用环境变量覆盖（便于不改配置文件直接运行）。"""
    cfg = load_yaml(CONFIG_DIR / "benchmark.yaml")
    ext = cfg.setdefault("external", {}) or {}
    for env, key in (("BENCH_MINECRAFT_SKILL", "minecraft_skill_dir"), ("BENCH_AXE_JS", "axe_core_js")):
        if os.environ.get(env):
            ext[key] = os.environ[env]
    cfg["external"] = ext
    if os.environ.get("BENCH_HEADFUL"):
        cfg.setdefault("browser", {})["headless"] = False
    return cfg


def dimensions(view: str | None = None, all_dims: bool = False) -> list[dict]:
    """雷达维度。带 `only_views` 的维度（如稳定性，只在 v2 完整版出现）默认不返回，
    需要时传 view='full'，或 all_dims=True 取全部（规范数据用）。"""
    ds = load_yaml(CONFIG_DIR / "dimensions.yaml")["dimensions"]
    if all_dims:
        return ds
    return [d for d in ds if not d.get("only_views") or view in d["only_views"]]


def task_dirs() -> dict[str, Path]:
    out = {}
    for d in sorted(TASKS_DIR.iterdir()):
        if d.is_dir() and (d / "rubric.yaml").exists():
            out[d.name.split("-")[0]] = d
    return out


def _merge_opts(a, b):
    """合并探针 opts：字典递归合并（子题覆盖），列表拼接去重。"""
    if isinstance(a, dict) and isinstance(b, dict):
        out = dict(a)
        for k, v in b.items():
            out[k] = _merge_opts(a[k], v) if k in a else v
        return out
    if isinstance(a, list) and isinstance(b, list):
        return a + [x for x in b if x not in a]
    return b


def _merge_rubric(base: dict, child: dict) -> dict:
    """子 rubric 在公共模板（tasks/_common/*.yaml）之上合并：
    标量/字典 子题覆盖；tier0 / gates / items 拼接（公共项在前）；同类型 probes 合并 opts，不同类型追加。"""
    out = dict(base)
    for k, v in child.items():
        if k in ("tier0", "gates", "items") and isinstance(v, list):
            out[k] = list(base.get(k) or []) + v
        elif k == "probes" and isinstance(v, list):
            probes = [dict(p) for p in (base.get("probes") or [])]
            for p in v:
                same = next((q for q in probes if q["type"] == p["type"]), None)
                if same is not None:
                    same["opts"] = _merge_opts(same.get("opts") or {}, p.get("opts") or {})
                else:
                    probes.append(p)
            out["probes"] = probes
        elif isinstance(v, dict) and isinstance(base.get(k), dict):
            out[k] = _merge_opts(base[k], v)
        else:
            out[k] = v
    return out


def _subst(obj, task_id: str):
    if isinstance(obj, str):
        return obj.replace("{T}", task_id)
    if isinstance(obj, list):
        return [_subst(x, task_id) for x in obj]
    if isinstance(obj, dict):
        return {k: _subst(v, task_id) for k, v in obj.items()}
    return obj


def load_rubric(task_id: str) -> dict:
    d = task_dirs()[task_id]
    r = load_yaml(d / "rubric.yaml")
    ext = r.pop("extends", None)
    if ext:
        base: dict = {}
        for name in ([ext] if isinstance(ext, str) else ext):
            part = _subst(load_yaml(TASKS_DIR / "_common" / f"{name}.yaml"), task_id)
            base = _merge_rubric(base, part)
        r = _merge_rubric(base, r)
    r["_dir"] = str(d)
    return r


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def run_cmd(cmd, cwd=None, timeout=600, env=None, shell=False) -> tuple[int, str, float]:
    t0 = time.time()
    try:
        p = subprocess.run(cmd, cwd=cwd, timeout=timeout, env=env, shell=shell,
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace")
        return p.returncode, p.stdout[-20000:], time.time() - t0
    except subprocess.TimeoutExpired as e:
        out = (e.stdout or "") if isinstance(e.stdout, str) else ""
        return 124, out[-20000:] + "\n[timeout]", time.time() - t0
    except FileNotFoundError as e:
        return 127, str(e), time.time() - t0


def which(name: str) -> bool:
    return shutil.which(name) is not None


@dataclass
class Metrics:
    """指标存储。值为 None 且登记在 na 中表示“评测环境原因无法检查”（不计入分母）；
    值缺失且未登记 na 表示“被测产出缺失”（按 0 分处理）。"""
    values: dict = field(default_factory=dict)
    na: dict = field(default_factory=dict)
    artifacts: dict = field(default_factory=dict)
    notes: list = field(default_factory=list)

    def set(self, key: str, value) -> None:
        self.values[key] = value

    def mark_na(self, key_or_prefix: str, reason: str) -> None:
        self.na[key_or_prefix] = reason

    def is_na(self, key: str) -> str | None:
        for k, reason in self.na.items():
            if key == k or key.startswith(k.rstrip("*")) and k.endswith("*"):
                return reason
        return None

    def to_dict(self) -> dict:
        return {"values": self.values, "na": self.na, "artifacts": self.artifacts, "notes": self.notes}

    @classmethod
    def from_dict(cls, d: dict) -> "Metrics":
        return cls(d.get("values", {}), d.get("na", {}), d.get("artifacts", {}), d.get("notes", []))


@dataclass
class RunContext:
    run_dir: Path
    meta: dict
    rubric: dict
    cfg: dict
    metrics: Metrics
    fast: bool = False

    @property
    def output_dir(self) -> Path:
        return self.run_dir / "output"

    @property
    def work_dir(self) -> Path:
        p = self.run_dir / "_grading"
        p.mkdir(exist_ok=True)
        return p

    @property
    def task_dir(self) -> Path:
        return Path(self.rubric["_dir"])

    def resolve(self, rel: str) -> Path:
        """在产出目录中定位文件：先按原路径，再在一级子目录里找（模型常把文件放进自己新建的文件夹）。"""
        p = self.output_dir / rel
        if p.exists():
            return p
        for sub in sorted(self.output_dir.iterdir()) if self.output_dir.exists() else []:
            if sub.is_dir() and (sub / rel).exists():
                return sub / rel
        return p

    def project_root(self) -> Path:
        """被测交付的项目根目录：rubric.deliverable_dir 指定的文件夹，找不到则用 output/ 本身。"""
        name = self.rubric.get("deliverable_dir")
        if name:
            p = self.output_dir / name
            if p.exists():
                return p
        return self.output_dir


def env_with(**kw) -> dict:
    e = dict(os.environ)
    e.update({k: str(v) for k, v in kw.items()})
    return e
