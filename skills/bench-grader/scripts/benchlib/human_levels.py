"""人工预览的 1–10 档文案。

四条 rubric 锚点原句放在 2、4、6、10 分（数组下标 1、3、5、9）。
其余六句是同一程度上的分辨，不进 rubric，Agent 仍读原来的四条。
"""
from __future__ import annotations

import json
from functools import lru_cache

from .common import SKILL_ROOT

LEVELS_PATH = SKILL_ROOT / "config" / "human-levels.json"


@lru_cache(maxsize=1)
def load_levels() -> dict:
    if not LEVELS_PATH.exists():
        return {}
    data = json.loads(LEVELS_PATH.read_text(encoding="utf-8"))
    return data if isinstance(data, dict) else {}


def levels_for(item: dict) -> list[str]:
    if item.get("method") != "human":
        return []
    hit = load_levels().get(item.get("id"))
    if isinstance(hit, list) and len(hit) == 10 and all(isinstance(x, str) and x.strip() for x in hit):
        return list(hit)
    return []
