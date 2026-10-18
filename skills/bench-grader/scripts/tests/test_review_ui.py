"""v2 评分页：两两比较配对、走查清单、预填与探索报告、盲评。"""
import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from benchlib import pairwise, review, review_ui  # noqa: E402
from benchlib.common import dump_json, load_json  # noqa: E402


def test_make_pairs_small_all_pairs_and_deterministic():
    al = ["R1", "R2", "R3", "R4"]
    p1, p2 = review_ui.make_pairs(al, "k"), review_ui.make_pairs(al, "k")
    assert p1 == p2 and len(p1) == 6
    assert {frozenset(p) for p in p1} == {frozenset((a, b)) for i, a in enumerate(al) for b in al[i + 1:]}


def test_make_pairs_large_is_connected_and_covers_everyone():
    al = [f"R{i:02d}" for i in range(12)]
    pairs = review_ui.make_pairs(al, "grp")
    deg = {a: 0 for a in al}
    adj = {a: set() for a in al}
    for a, b in pairs:
        deg[a] += 1
        deg[b] += 1
        adj[a].add(b)
        adj[b].add(a)
    assert min(deg.values()) >= 3 and len(pairs) < 66
    seen, st = {al[0]}, [al[0]]
    while st:
        for n in adj[st.pop()]:
            if n not in seen:
                seen.add(n)
                st.append(n)
    assert seen == set(al)
    assert len(set(frozenset(p) for p in pairs)) == len(pairs)


def _mk_run(data: Path, rid: str, task: str, model: str, views=True):
    rd = data / "runs" / rid
    (rd / "output").mkdir(parents=True)
    dump_json(rd / "meta.json", {"run_id": rid, "task": task, "model": model, "harness": "h", "variant": None, "run_index": 1})
    dump_json(rd / "metrics.json", {"values": {}, "na": {}, "artifacts": {}, "notes": []})
    if views:
        cdir = rd / "_grading" / "capture"
        cdir.mkdir(parents=True)
        (cdir / "view_facade.png").write_bytes(b"png")
        dump_json(cdir / "manifest.json", {"views": [{"id": "facade", "label": "立面", "png": "view_facade.png", "rendered": True}], "orbit": [], "parts": {"tree": []}})


def test_packet_pairs_walkthrough_prefill_blind(tmp_path):
    data = tmp_path / "d"
    models = ["SecretModelAlpha", "SecretModelBeta", "SecretModelGamma"]
    for i, m in enumerate(models):
        _mk_run(data, f"r{i}", "V06", m)
    rv = data / "review"
    rv.mkdir(parents=True)
    aliases = review.alias_map(data)
    a0 = aliases["r0"]
    dump_json(rv / "agent_prefill.json", {"scores": [{"alias": a0, "item_id": "V06-H00", "score": 2, "reason": "两个按钮无效"}], "pairs": []})
    (rv / "exploration").mkdir()
    (rv / "exploration" / f"{a0}.md").write_text("点了 6 个控件，其中“切换昼夜”无反应", encoding="utf-8")

    res = review.build_packet(data)
    assert res["pairs"] > 0
    html = (rv / "index.html").read_text(encoding="utf-8")
    assert all(m not in html for m in models), "评分页不能泄漏模型名"
    assert "走查清单" in html and "两两比较" in html and "两个按钮无效" in html and "切换昼夜" in html

    sheet = list(csv.DictReader(open(rv / "pairwise_sheet.csv", encoding="utf-8-sig")))
    items = {r["item_id"] for r in sheet}
    assert {"V06-H04", "V06-H05"} <= items and all(r["winner"] == "" for r in sheet)
    assert len(sheet) == 3 * len(items)
    human = list(csv.DictReader(open(rv / "human_sheet.csv", encoding="utf-8-sig")))
    assert not ({r["item_id"] for r in human} & items), "两两比较项不进绝对打分表"
    assert any(r["item_id"] == "V06-H00" for r in human)

    req = json.loads((rv / "agent_prefill_request.json").read_text(encoding="utf-8"))
    assert req["requests"] and req["pairs"] and "walkthrough" in req
    assert any(img.endswith("view_facade.png") for r in req["requests"] for img in r["images"])


def test_single_run_pairwise_falls_back_to_absolute(tmp_path):
    data = tmp_path / "d"
    _mk_run(data, "r0", "V06", "OnlyModel", views=False)
    res = review.build_packet(data)
    assert res["pairs"] == 0
    human = list(csv.DictReader(open(data / "review" / "human_sheet.csv", encoding="utf-8-sig")))
    assert any(r["item_id"] == "V06-H04" for r in human)


def test_pairwise_roundtrip_from_sheet(tmp_path):
    data = tmp_path / "d"
    for i in range(3):
        _mk_run(data, f"r{i}", "V06", f"M{i}", views=False)
    review.build_packet(data)
    rows = list(csv.DictReader(open(data / "review" / "pairwise_sheet.csv", encoding="utf-8-sig")))
    inv = {v: k for k, v in review.alias_map(data).items()}
    # 让 r0 全胜、r2 全败
    rank = {"r0": 2, "r1": 1, "r2": 0}
    out = tmp_path / "pw.csv"
    with open(out, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["task", "item_id", "a", "b", "winner"])
        for r in rows:
            ra, rb = inv[r["a"]], inv[r["b"]]
            w.writerow([r["task"], r["item_id"], r["a"], r["b"], "a" if rank[ra] > rank[rb] else "b"])
    rep = pairwise.ingest(data, out)
    assert rep["written"] > 0 and rep["skipped"] == 0
    s0 = load_json(data / "runs" / "r0" / "manual_scores.json")["V06-H04"]["score"]
    s2 = load_json(data / "runs" / "r2" / "manual_scores.json")["V06-H04"]["score"]
    assert s0 == 3.0 and s2 == 0.0


def test_review_page_runs_in_browser(tmp_path):
    """真实浏览器里打开评分页：无脚本报错；采纳预填、两两比较选择、走查清单提示、导出 CSV 都能工作。"""
    import pytest
    try:
        from benchlib.probes.jslib import browser_session
        with browser_session(True):
            pass
    except Exception:  # noqa: BLE001
        pytest.skip("需要 playwright + Chromium")
    data = tmp_path / "d"
    for i in range(3):
        _mk_run(data, f"r{i}", "V06", f"M{i}", views=False)
    rv = data / "review"
    rv.mkdir(parents=True)
    al = review.alias_map(data)["r0"]
    dump_json(rv / "agent_prefill.json", {"scores": [{"alias": al, "item_id": "V06-H00", "score": 2, "reason": "r"}], "pairs": []})
    review.build_packet(data)
    errors = []
    with browser_session(True) as b:
        page = b.new_page(accept_downloads=True)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto((rv / "index.html").resolve().as_uri())
        page.click("[data-adopt]")
        page.locator(".pair .picks label").first.click()
        page.locator(".walk select").first.select_option("bad")
        assert "失败 1 项" in page.locator("[data-hint]").first.inner_text()
        with page.expect_download() as dl:
            page.click("#expp")
        text = Path(dl.value.path()).read_text(encoding="utf-8-sig")
        assert "winner" in text and ",a," in text.replace('"', "")
        with page.expect_download() as dl2:
            page.click("#exp")
        t2 = Path(dl2.value.path()).read_text(encoding="utf-8-sig")
        assert "prefill_adopted" in t2 and "V06-H00" in t2
    assert not errors
