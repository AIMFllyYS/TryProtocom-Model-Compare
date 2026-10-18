"""人工 / agent 评分与用量补录：生成统一的评分包，导入用户填写结果。

原则：
- 人工评分一次性汇总询问：同一检查项的所有运行放在一起横向比较（盲评，只显示别名）。
- agent 项由执行本 skill 的 agent 阅读代码/文档后填写并附证据，用户可覆盖。
- 用时成本缺失的运行汇总到 usage_needed.csv，一次性请用户补充。
"""
from __future__ import annotations

import csv
import json
import os
from pathlib import Path

from . import review_ui
from .agent_accept import keep_agent_score
from .common import dimensions, dump_json, load_json, load_rubric
from .scoring import TIER_LABEL
from .runs import alias_map, all_meta, rescore
from .usage import USER_FIELDS, resolve_usage

SHEET_FIELDS = ["task", "item_id", "method", "dim", "tier", "criterion", "anchor_0", "anchor_1", "anchor_2", "anchor_3", "evidence", "alias", "open", "score", "note"]


DIM_NAME = {d["id"]: d["name"] for d in dimensions()}


def build_packet(data: Path, task: str | None = None) -> dict:
    rv = data / "review"
    rv.mkdir(parents=True, exist_ok=True)
    aliases = alias_map(data)
    rows = {"human": [], "agent": []}
    cards = []
    for meta in all_meta(data):
        if task and meta["task"] != task:
            continue
        rd = Path(meta["_dir"])
        sc = rescore(rd)
        rub = load_rubric(meta["task"])
        items = {it["id"]: it for it in rub.get("items", [])}
        metrics = load_json(rd / "metrics.json", {}) or {}
        arts = metrics.get("artifacts", {})
        entry = _entry(rd, rub)
        for r in sc["items"]:
            if r["status"] != "pending":
                continue
            it = items[r["id"]]
            anchors = it.get("anchors", ["", "", "", ""])
            row = {"task": meta["task"] + (meta.get("variant") or ""), "item_id": r["id"], "method": r["method"], "dim": DIM_NAME.get(r["dim"], r["dim"]),
                   "tier": TIER_LABEL.get(r["tier"], r["tier"]), "criterion": it["desc"], "anchor_0": anchors[0], "anchor_1": anchors[1], "anchor_2": anchors[2],
                   "anchor_3": anchors[3], "evidence": it.get("evidence", ""), "alias": aliases[meta["run_id"]],
                   "open": os.path.relpath(entry, rv) if entry else "", "score": "", "note": ""}
            shots = [arts[k] for k in ("desktop", "timeline_contact", "mobile") if arts.get(k)] + [p for k, p in arts.items() if k.startswith("shots_")]
            media = review_ui.capture_media(rd, rv)
            judge = it.get("judge") or "absolute"
            walk = None
            if r["method"] == "human" and r["id"].endswith("-H00"):
                walk = rub.get("walkthrough") or review_ui.DEFAULT_WALKTHROUGH
            card = {**row, "judge": judge, "shots": [os.path.relpath(p, rv) for p in shots if p.endswith((".png", ".jpg")) and Path(p).exists()][:4],
                    "video": os.path.relpath(arts["review_video"], rv) if arts.get("review_video") and Path(arts["review_video"]).exists() else
                             (os.path.relpath(arts["video"], rv) if arts.get("video") and Path(arts["video"]).exists() else ""),
                    "views": media["views"], "orbit_video": media["orbit_video"], "walkthrough": walk}
            rows[r["method"]].append(row)
            cards.append(card)
    # 两两比较：同题同检查项下至少 2 个作品才配对；否则退回绝对打分
    human = [c for c in cards if c["method"] == "human"]
    by_group: dict[tuple, list[dict]] = {}
    for c in human:
        if c["judge"] == "pairwise":
            by_group.setdefault((c["task"], c["item_id"]), []).append(c)
    pairs, paired_keys = [], set()
    for (tk, item), lst in sorted(by_group.items()):
        al = sorted({c["alias"] for c in lst})
        if len(al) < 2:
            continue
        paired_keys.add((tk, item))
        byalias = {c["alias"]: c for c in lst}
        for a, b in review_ui.make_pairs(al, f"{tk}|{item}"):
            base = byalias[a]
            pairs.append({"task": tk, "item_id": item, "criterion": base["criterion"], "dim": base["dim"], "tier": base["tier"], "evidence": base["evidence"],
                          **{f"anchor_{i}": base[f"anchor_{i}"] for i in range(4)}, "a": byalias[a], "b": byalias[b]})
    abs_cards = [c for c in human if (c["task"], c["item_id"]) not in paired_keys]
    for kind in ("human", "agent"):
        keep = [r for r in rows[kind] if (r["task"], r["item_id"]) not in paired_keys]
        keep.sort(key=lambda r: (r["task"], r["item_id"], r["alias"]))
        with open(rv / f"{kind}_sheet.csv", "w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=SHEET_FIELDS)
            w.writeheader()
            w.writerows(keep)
        rows[kind] = keep
    with open(rv / "pairwise_sheet.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["task", "item_id", "a", "b", "winner", "note", "criterion"])
        for p in pairs:
            w.writerow([p["task"], p["item_id"], p["a"]["alias"], p["b"]["alias"], "", "", p["criterion"]])
    payload = {"cards": abs_cards, "pairs": pairs, "walkthrough": review_ui.DEFAULT_WALKTHROUGH,
               "prefill": review_ui.load_prefill(rv), "exploration": review_ui.load_exploration(rv)}
    (rv / "index.html").write_text(review_ui.render_html(payload), encoding="utf-8")
    (rv / "agent_prefill_request.json").write_text(json.dumps(review_ui.prefill_request(abs_cards, pairs, review_ui.DEFAULT_WALKTHROUGH), ensure_ascii=False, indent=1), encoding="utf-8")
    usage_rows = usage_needed(data)
    return {"human": len(rows["human"]), "agent": len(rows["agent"]), "pairs": len(pairs), "usage_missing": len(usage_rows), "dir": str(rv)}


def _entry(rd: Path, rub: dict) -> Path | None:
    root = rd / "output" / rub.get("deliverable_dir", "")
    for cand in ("dist/index.html", "index.html", "final.mp4", "FIXES.md", "README.md"):
        p = root / cand
        if p.exists():
            return p
    return root if root.exists() else None


def usage_needed(data: Path) -> list[dict]:
    from .common import bench_config
    cfg = bench_config()
    out = []
    for meta in all_meta(data):
        u = resolve_usage(meta, cfg)
        meta_path = Path(meta["_dir"]) / "meta.json"
        m = load_json(meta_path)
        m["usage_resolved"] = u
        dump_json(meta_path, m)
        if u["missing"]:
            out.append({"run_id": meta["run_id"], "task": meta["task"] + (meta.get("variant") or ""), "model": meta["model"],
                        "harness": meta["harness"], "workspace": meta.get("workspace") or "", "started_at": meta.get("started_at") or "",
                        "found_source": u["source"], "missing": "|".join(u["missing"]),
                        **{k: u.get(k, "") for k in USER_FIELDS}})
    rv = data / "review"
    rv.mkdir(parents=True, exist_ok=True)
    with open(rv / "usage_needed.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=["run_id", "task", "model", "harness", "workspace", "started_at", "found_source", "missing", *USER_FIELDS])
        w.writeheader()
        w.writerows(out)
    return out


def ingest_scores(data: Path, csv_path: Path, by: str | None = None) -> int:
    aliases = alias_map(data)
    inv = {v: k for k, v in aliases.items()}
    n = 0
    with open(csv_path, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            s = (row.get("score") or "").strip()
            if s == "":
                continue
            rid = inv.get(row["alias"].strip())
            if not rid:
                continue
            rd = data / "runs" / rid
            ms = load_json(rd / "manual_scores.json", {}) or {}
            iid = row["item_id"].strip()
            ms[iid] = keep_agent_score(ms.get(iid), {"score": max(0.0, min(3.0, float(s))), "note": row.get("note", ""), "by": by or row.get("method", "human")})
            dump_json(rd / "manual_scores.json", ms)
            n += 1
    for meta in all_meta(data):
        rescore(Path(meta["_dir"]))
    return n


def ingest_usage(data: Path, csv_path: Path) -> int:
    n = 0
    with open(csv_path, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            rd = data / "runs" / row["run_id"].strip()
            meta = load_json(rd / "meta.json")
            if not meta:
                continue
            u = meta.get("usage") or {}
            for k in USER_FIELDS:
                v = (row.get(k) or "").strip()
                if v:
                    u[k] = float(v)
            meta["usage"] = u
            dump_json(rd / "meta.json", meta)
            n += 1
    return n
