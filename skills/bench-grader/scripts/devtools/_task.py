"""devtools 共用：按题号找到 tasks/<题号>-* 目录。"""
from pathlib import Path

TASKS = Path(__file__).resolve().parents[2] / "tasks"


def task_dir(task: str) -> Path:
    matches = sorted(TASKS.glob(task + "-*"))
    if len(matches) != 1:
        raise SystemExit(f"题号 {task} 匹配到 {len(matches)} 个目录")
    return matches[0]
