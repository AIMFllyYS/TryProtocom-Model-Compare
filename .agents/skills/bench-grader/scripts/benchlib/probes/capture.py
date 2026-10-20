"""v2 创作类题的采集与审计探针：

- capture：命名视角逐个取景（截图 + 画面统计）、环绕拖动检查、部件树 / 期望部件名检查，产出评分页要用的截图与环绕视频。
- scene_audit：rig 完整性（部件是否漂浮 / 严重穿插 / 关键接触是否成立），可在时间线或运行过程中多次采样。
- voxel_audit：体素语法（对齐网格、等大、尺度、层次、内部空腔），只读 __scene 里的方块。

这些探针只检查“能不能被看见、被检查”和“有没有严重结构缺陷”，不数网格 / 三角面 / 材质种类，
不对建模手段打分。画面好不好看、像不像，交给两两比较的人工评审。
"""
from __future__ import annotations

import io
import json
import re
import shutil
import subprocess
import time
from contextlib import contextmanager
from pathlib import Path

from ..common import RunContext
from .captlib import NAMES_JS, RIG_JS, VOXEL_JS
from .jslib import LAST_RENDERER, browser_session, distinct_count, thumb


# ------------------------------------------------------------------ 公共：打开页面


def _entry_rel(ctx: RunContext, opts: dict) -> str:
    if opts.get("entry"):
        return opts["entry"]
    for p in ctx.rubric.get("probes") or []:
        o = p.get("opts") or {}
        if p.get("type") in ("browser", "files", "timeline") and o.get("entry"):
            return o["entry"]
    return "index.html"


def _entry_url(ctx: RunContext, opts: dict) -> str | None:
    rel = _entry_rel(ctx, opts)
    root = ctx.project_root()
    entry = root / rel
    if not entry.exists():
        cands = [c for c in sorted(root.rglob(Path(rel).name)) if "node_modules" not in c.parts]
        if not cands:
            return None
        entry = cands[0]
    return entry.resolve().as_uri() + opts.get("query", "")


@contextmanager
def open_page(ctx: RunContext, opts: dict, viewport=(1280, 720)):
    """打开被测页面；加载失败时 yield None。不记录报错 / 网络请求（那是 browser 探针的职责）。"""
    url = _entry_url(ctx, opts)
    if url is None:
        yield None
        return
    headless = (ctx.cfg.get("browser") or {}).get("headless", True)
    with browser_session(headless) as browser:
        ctx.metrics.set("capture.gl_renderer", LAST_RENDERER.get("renderer"))
        c = browser.new_context(viewport={"width": viewport[0], "height": viewport[1]})
        page = c.new_page()
        page.set_default_timeout(int(opts.get("timeout_s", 30)) * 1000)
        try:
            page.goto(url, wait_until="load", timeout=60000)
        except Exception as e:  # noqa: BLE001
            ctx.metrics.notes.append(f"capture: 页面加载失败 {str(e)[:200]}")
            c.close()
            yield None
            return
        page.wait_for_timeout(int(opts.get("wait_ms", 3000)))
        try:
            yield page
        finally:
            c.close()


def wait_scene(page, path: str = "__scene", limit_s: float = 15.0) -> bool:
    js = "(p) => { const v = p.split('.').reduce((o,k)=>o==null?undefined:o[k], window); return !!(v && typeof v.traverse === 'function'); }"
    end = time.time() + limit_s
    while time.time() < end:
        try:
            if page.evaluate(js, path):
                page.wait_for_timeout(500)
                return True
        except Exception:  # noqa: BLE001
            pass
        page.wait_for_timeout(250)
    return False


# ------------------------------------------------------------------ 画面统计


def luma_stats(png: bytes) -> dict:
    """亮度均值、熵（比特）、动态范围（p99 − p1）、最大单色占比。"""
    import numpy as np
    from PIL import Image
    im = Image.open(io.BytesIO(png)).convert("L")
    im.thumbnail((640, 640))
    a = np.asarray(im, dtype="uint8")
    hist = np.bincount(a.ravel(), minlength=256).astype("float64")
    p = hist / hist.sum()
    nz = p[p > 0]
    entropy = float(-(nz * np.log2(nz)).sum())
    mode_frac = float(max(hist[max(i - 4, 0):i + 5].sum() for i in range(256)) / hist.sum())
    return {
        "mean": float(a.mean()), "entropy": entropy,
        "range": float(np.percentile(a, 99) - np.percentile(a, 1)), "mode_frac": mode_frac,
        "std": float(a.std()),
    }


def _nonblank(st: dict) -> bool:
    return st["std"] > 3.0 and st["mode_frac"] < 0.985


# ------------------------------------------------------------------ capture


def _depth(tree: list) -> int:
    parent = {p["id"]: p["parent"] for p in tree}
    best = 0
    for pid in parent:
        d, cur, guard = 1, parent.get(pid), 0
        while cur is not None and cur in parent and guard < 64:
            d += 1
            cur = parent[cur]
            guard += 1
        best = max(best, d)
    return best


def _orbit(page, n: int, outdir: Path):
    """在画布中心按住鼠标横向拖动 n 次，每次截图。返回 (是否有效, 帧文件列表, 诊断)。"""
    import numpy as np
    box = None
    try:
        box = page.evaluate("() => { let b = null, a = 0; for (const c of document.querySelectorAll('canvas')) { const r = c.getBoundingClientRect(); if (r.width * r.height > a) { a = r.width * r.height; b = {x: r.x, y: r.y, w: r.width, h: r.height}; } } return b; }")
    except Exception:  # noqa: BLE001
        pass
    vw = page.viewport_size or {"width": 1280, "height": 720}
    cx = (box["x"] + box["w"] / 2) if box else vw["width"] / 2
    cy = (box["y"] + box["h"] / 2) if box else vw["height"] / 2
    span = min((box["w"] if box else vw["width"]) * 0.12, 160)
    base = page.screenshot()
    page.wait_for_timeout(700)
    idle = page.screenshot()  # 控制：不操作时画面自己的变化（自动旋转 / 动画）
    t_base, t_idle = thumb(base), thumb(idle)
    idle_diff = float(np.mean(np.abs(t_base - t_idle)))
    frames, thumbs = [base], [t_base]
    for _ in range(n):
        page.mouse.move(cx, cy)
        page.mouse.down()
        for k in range(1, 9):
            page.mouse.move(cx + span * k / 8, cy + (span * 0.15 if k % 2 else 0))
        page.mouse.up()
        page.wait_for_timeout(450)
        b = page.screenshot()
        frames.append(b)
        thumbs.append(thumb(b))
    diffs = [float(np.mean(np.abs(t - t_base))) for t in thumbs[1:]]
    ok = bool(diffs) and max(diffs) > max(4.0, idle_diff * 1.5 + 2.0)
    files = []
    for i, b in enumerate(frames):
        f = outdir / f"orbit_{i:02d}.png"
        f.write_bytes(b)
        files.append(f.name)
    return ok, files, {"idle_diff": round(idle_diff, 2), "max_drag_diff": round(max(diffs), 2) if diffs else 0}


def _orbit_video(outdir: Path, n_frames: int) -> str | None:
    if n_frames < 2 or not shutil.which("ffmpeg"):
        return None
    out = outdir / "orbit.mp4"
    try:
        r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", "3", "-i", str(outdir / "orbit_%02d.png"),
                            "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(out)],
                           capture_output=True, timeout=120)
        return out.name if r.returncode == 0 and out.exists() else None
    except Exception:  # noqa: BLE001
        return None


def match_expected(expected: list, pool: list[str]) -> tuple[dict, dict]:
    """期望部件：名字能在部件树 / 场景节点名里找到即算有。返回 ({module: 命中率}, {part_id: 是否命中})。"""
    by_mod: dict[str, list[bool]] = {}
    found: dict[str, bool] = {}
    for e in expected:
        try:
            rx = re.compile(e["re"], re.I)
        except re.error:
            continue
        hit = any(rx.search(n) for n in pool)
        found[e["id"]] = hit
        by_mod.setdefault(e.get("module", "all"), []).append(hit)
    return {mod: sum(h) / len(h) for mod, h in by_mod.items()}, found


def capture_probe(ctx: RunContext, opts: dict) -> None:
    m = ctx.metrics
    try:
        import playwright  # noqa: F401
    except ImportError:
        m.mark_na("capture.*", "未安装 playwright")
        return
    cfg = ctx.rubric.get("capture") or {}
    views = cfg.get("views") or []
    outdir = ctx.work_dir / "capture"
    outdir.mkdir(exist_ok=True)
    manifest: dict = {"views": [], "orbit": [], "parts": {}, "expected": {}}
    scene_path = "__scene"

    with open_page(ctx, opts) as page:
        if page is None:
            m.set("capture.default_nonblank", False)
            m.set("capture.views_total", len(views))
            m.set("capture.views_rendered_ratio", 0.0)
            m.set("capture.views_distinct_ratio", 0.0)
            m.set("capture.orbit_ok", False)
            return

        # 默认画面（首屏）
        first = page.screenshot()
        (outdir / "default.png").write_bytes(first)
        m.set("capture.default_nonblank", _nonblank(luma_stats(first)))
        m.artifacts["capture_default"] = str(outdir / "default.png")

        # 命名视角
        thumbs, stats = [], []
        settle = int(cfg.get("settle_ms", 1800))
        for v in views:
            vid = v["id"]
            rec = {"id": vid, "label": v.get("label", vid), "png": None, "rendered": False, "error": None}
            try:
                page.evaluate("async (id) => { const b = window.__bench; if (!b || typeof b.setView !== 'function') throw new Error('__bench.setView 不存在'); await b.setView(id); }", vid)
                page.wait_for_timeout(settle)
                png = page.screenshot()
                st = luma_stats(png)
                f = outdir / f"view_{vid}.png"
                f.write_bytes(png)
                rec.update(png=f.name, rendered=_nonblank(st), stats={k: round(x, 3) for k, x in st.items()})
                if rec["rendered"]:
                    thumbs.append(thumb(png))
                    stats.append((vid, st))
            except Exception as e:  # noqa: BLE001
                rec["error"] = str(e)[:200]
            manifest["views"].append(rec)
        if views:
            rendered = sum(1 for r in manifest["views"] if r["rendered"])
            m.set("capture.views_total", len(views))
            m.set("capture.views_rendered_ratio", rendered / len(views))
            m.set("capture.views_distinct_ratio", (distinct_count(thumbs) / len(thumbs)) if thumbs else 0.0)
            if stats:
                m.set("capture.entropy_mean", round(sum(s["entropy"] for _, s in stats) / len(stats), 3))
                m.set("capture.dynamic_range_mean", round(sum(s["range"] for _, s in stats) / len(stats), 2))
            dusk = next((s for vid, s in stats if vid == "dusk"), None)
            others = [s["mean"] for vid, s in stats if vid != "dusk"]
            if dusk is not None and others:
                m.set("capture.dusk_luma_shift", round(abs(dusk["mean"] - sum(others) / len(others)) / 255.0, 4))
            elif any(v["id"] == "dusk" for v in views):
                m.set("capture.dusk_luma_shift", 0.0)
            m.artifacts["capture_views"] = str(outdir / "view_*.png")

        # 环绕拖动
        orbit_cfg = cfg.get("orbit")
        if orbit_cfg is not None:
            try:
                ok, files, info = _orbit(page, int((orbit_cfg or {}).get("frames", 6)), outdir)
                m.set("capture.orbit_ok", ok)
                manifest["orbit"] = files
                manifest["orbit_info"] = info
                vid = _orbit_video(outdir, len(files))
                if vid:
                    manifest["orbit_video"] = vid
                    m.artifacts["capture_orbit"] = str(outdir / vid)
            except Exception as e:  # noqa: BLE001
                m.set("capture.orbit_ok", False)
                m.notes.append(f"capture: 环绕检查失败 {str(e)[:200]}")

        # 部件树 / 期望部件
        expected = cfg.get("expected_parts") or []
        if expected or cfg.get("parts"):
            try:
                names = page.evaluate(NAMES_JS, {"scene": scene_path})
            except Exception as e:  # noqa: BLE001
                names = {"tree": [], "nodes": [], "tree_error": str(e)[:200]}
            tree, nodes = names.get("tree") or [], names.get("nodes") or []
            m.set("capture.parts.count", len(tree))
            m.set("capture.parts.depth", _depth(tree) if tree else 0)
            m.set("capture.parts.scene_nodes", len(nodes))
            pool = [p["name"] for p in tree] + [p["id"] for p in tree] + nodes
            pcfg = cfg.get("parts") or {}
            if pcfg.get("min_parts") is not None:
                m.set("capture.parts_ok", len(tree) >= int(pcfg["min_parts"]))
            ratios, found = match_expected(expected, pool)
            for mod, r in ratios.items():
                m.set(f"capture.expected.{mod}", r)
            if found:
                m.set("capture.expected_all", sum(found.values()) / len(found))
            manifest["parts"] = {"tree": tree[:600], "tree_error": names.get("tree_error")}
            manifest["expected"] = found
    (outdir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")


# ------------------------------------------------------------------ scene_audit


_SEEK_JS = """async (a) => { const parts = a.path.split('.'); const get = (p) => p.reduce((o, k) => (o == null ? undefined : o[k]), window);
  const fn = get(parts), owner = get(parts.slice(0, -1)); if (typeof fn !== 'function') throw new Error(a.path + ' 不存在'); await fn.call(owner, a.t); }"""


def scene_audit_probe(ctx: RunContext, opts: dict) -> None:
    m = ctx.metrics
    try:
        import playwright  # noqa: F401
    except ImportError:
        m.mark_na("rig.*", "未安装 playwright")
        return
    cfg = ctx.rubric.get("capture") or {}
    audit = {**(cfg.get("audit") or {}), **(opts.get("audit") or {})}
    args = {"scene": "__scene", "tol": audit.get("tol"), "exclude": audit.get("exclude"), "include": audit.get("include"),
            "overlay": audit.get("overlay"), "contacts": cfg.get("contacts") or []}
    series: list[dict] = []
    with open_page(ctx, opts) as page:
        if page is None:
            m.mark_na("rig.*", "页面无法加载，无法审计场景")
            return
        if not wait_scene(page, "__scene", float(opts.get("wait_s", 15))):
            m.mark_na("rig.*", "页面没有暴露可遍历的 __scene（非 three.js 作品，或未按契约挂出）")
            return
        first = page.evaluate(RIG_JS, args)
        if not first or not first.get("subject"):
            m.mark_na("rig.*", "场景里找不到可审计的主体网格")
            return
        series.append(first)
        motion = cfg.get("motion") or {}
        try:
            times = motion.get("times")
            if motion.get("seek") and not times and motion.get("fractions"):
                # 时长由作品自己决定：按 <seek 所在对象>.duration 的比例取点
                owner = ".".join(str(motion["seek"]).split(".")[:-1]) or "window"
                dur = page.evaluate("(p) => { let o = window; for (const k of p.split('.')) { if (!k || k === 'window') continue; o = o && o[k]; } return o && typeof o.duration === 'number' ? o.duration : null; }", owner)
                if isinstance(dur, (int, float)) and dur > 0:
                    times = [round(float(f) * float(dur), 3) for f in motion["fractions"]]
            if motion.get("seek") and times:
                for t in times:
                    page.evaluate(_SEEK_JS, {"path": motion["seek"], "t": t})
                    page.wait_for_timeout(int(motion.get("settle_ms", 350)))
                    r = page.evaluate(RIG_JS, {**args, "contacts": []})
                    if r and r.get("subject"):
                        series.append(r)
            elif motion.get("samples"):
                for _ in range(int(motion["samples"])):
                    page.wait_for_timeout(int(motion.get("interval_ms", 500)))
                    r = page.evaluate(RIG_JS, {**args, "contacts": []})
                    if r and r.get("subject"):
                        series.append(r)
        except Exception as e:  # noqa: BLE001
            m.notes.append(f"scene_audit: 运动采样中断 {str(e)[:200]}")
    publish_rig(m, series)
    (ctx.work_dir / "rig_audit.json").write_text(json.dumps({"series": series}, ensure_ascii=False, indent=1), encoding="utf-8")


def publish_rig(m, series: list[dict]) -> None:
    first = series[0]
    m.set("rig.parts", first["parts"])
    m.set("rig.subject_parts", first["subject"])
    m.set("rig.floating_ratio", round(first["floating"], 4))
    m.set("rig.deep_clip_ratio", round(first["clipped"], 4))
    m.set("rig.motion_floating_max", round(max(s["floating"] for s in series), 4))
    m.set("rig.motion_deep_clip_max", round(max(s["clipped"] for s in series), 4))
    m.set("rig.samples", len(series))
    contacts = first.get("contacts") or []
    if contacts:
        m.set("rig.contacts_ok_ratio", sum(1 for c in contacts if c["ok"]) / len(contacts))
        m.set("rig.contacts_found_ratio", sum(1 for c in contacts if c["found"]) / len(contacts))


# ------------------------------------------------------------------ voxel_audit


def voxel_audit_probe(ctx: RunContext, opts: dict) -> None:
    m = ctx.metrics
    try:
        import playwright  # noqa: F401
    except ImportError:
        m.mark_na("voxel.*", "未安装 playwright")
        return
    res = None
    with open_page(ctx, opts) as page:
        if page is None:
            m.set("voxel.available", False)
            return
        if not wait_scene(page, "__scene", float(opts.get("wait_s", 20))):
            m.set("voxel.available", False)
            m.notes.append("voxel_audit: 页面没有暴露可遍历的 __scene")
            return
        try:
            res = page.evaluate(VOXEL_JS, {"scene": "__scene", "block_size_from": opts.get("block_size_from"), "min_blocks": opts.get("min_blocks", 50)})
        except Exception as e:  # noqa: BLE001
            m.notes.append(f"voxel_audit 失败: {str(e)[:300]}")
    publish_voxel(m, res)
    if res:
        (ctx.work_dir / "voxel_audit.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")


def publish_voxel(m, res: dict | None) -> None:
    if not res or not res.get("available"):
        m.set("voxel.available", False)
        if res:
            m.set("voxel.blocks", res.get("blocks", 0))
        return
    m.set("voxel.available", True)
    for k in ("blocks", "block_size", "aligned_ratio", "uniform_ratio", "structure_blocks", "extent_max", "height_levels",
              "palette_size", "non_axis_faces", "axis_faces"):
        if res.get(k) is not None:
            m.set(f"voxel.{k}", res[k])
    ex = res.get("extent") or [0, 0, 0]
    m.set("voxel.extent_x", ex[0])
    m.set("voxel.extent_y", ex[1])
    m.set("voxel.extent_z", ex[2])
    if res.get("interior_void_ratio") is not None:
        m.set("voxel.interior_void_ratio", round(res["interior_void_ratio"], 4))
    else:
        m.mark_na("voxel.interior_void_ratio", "结构包围盒过大，跳过空腔分析")
