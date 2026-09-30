"""时间轴探针：针对暴露 seek(t) 的动画页面（FILM / __hf），逐帧采样。

指标：确定性、空白帧、静止时长、切换密度、节拍对齐、文字碰撞/多行、定格节奏、相机一致性、镜头表一致性；
可选：逐帧渲染出评审用 MP4（统一渲染管线）。
"""
from __future__ import annotations

import io
import json
import random
import shutil
import subprocess
from pathlib import Path

from ..common import RunContext, load_json
from .jslib import INIT_SCRIPT, TEXT_LAYOUT_JS, browser_session, thumb

SEEK_JS = r"""
async ([g, t]) => {
  const o = window[g];
  const r = o.seek(t);
  if (r && typeof r.then === 'function') await r;
  await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
}
"""


def timeline_probe(ctx: RunContext, opts: dict) -> None:
    import numpy as np
    m = ctx.metrics
    g = opts.get("global", "__hf")
    entry = ctx.project_root() / opts.get("entry", "index.html")
    if not entry.exists():
        m.set("tl.hook_ok", False)
        return
    q = opts.get("query", "")
    url = entry.resolve().as_uri() + q
    art = ctx.work_dir / "timeline"
    art.mkdir(exist_ok=True)
    vw, vh = opts.get("viewport", [1920, 1080])
    headless = (ctx.cfg.get("browser") or {}).get("headless", True)
    with browser_session(headless) as browser:
        c = browser.new_context(viewport={"width": vw, "height": vh})
        c.add_init_script(INIT_SCRIPT)
        page = c.new_page()
        page.set_default_timeout(60000)
        try:
            page.goto(url, wait_until="load", timeout=60000)
        except Exception as e:  # noqa: BLE001
            m.set("tl.hook_ok", False)
            m.notes.append(f"timeline load failed: {e}")
            return
        page.wait_for_timeout(2500)
        info = page.evaluate("(g) => { const o = window[g]; if (!o) return null; return {duration: o.duration, fps: o.fps, poseFps: o.poseFps, hasSeek: typeof o.seek === 'function', hasPause: typeof o.pause === 'function', hasPose: typeof o.getPose === 'function', hasCam: typeof o.cameraAt === 'function', shots: Array.isArray(o.shots) ? o.shots : null}; }", g)
        if not info or not info["hasSeek"] or not isinstance(info.get("duration"), (int, float)):
            m.set("tl.hook_ok", False)
            return
        m.set("tl.hook_ok", True)
        dur = float(info["duration"])
        m.set("tl.duration", dur)
        exp = opts.get("expected_duration")
        if exp:
            m.set("tl.duration_err", abs(dur - exp))
        if info["hasPause"]:
            page.evaluate(f"() => window['{g}'].pause()")

        def seek(t):
            page.evaluate(SEEK_JS, [g, float(t)])

        # ---------- 采样 ----------
        fs = float(opts.get("sample_fps", 4))
        n = max(2, int(dur * fs))
        times = [i / fs for i in range(n)]
        thumbs, layouts, keep = [], [], []
        text_every = int(opts.get("text_every", 1))
        for i, t in enumerate(times):
            seek(t)
            b = page.screenshot(type="jpeg", quality=70)
            thumbs.append(thumb(b, (160, 90)))
            if opts.get("text") and i % text_every == 0:
                layouts.append(page.evaluate(TEXT_LAYOUT_JS))
            if i % max(1, n // 12) == 0 and len(keep) < 12:
                keep.append((t, b))
        diffs = [float(np.mean(np.abs(thumbs[i] - thumbs[i - 1]))) for i in range(1, len(thumbs))]
        stds = [float(np.std(x)) for x in thumbs]
        m.set("tl.samples", n)
        m.set("tl.blank_ratio", round(sum(1 for s in stds if s < 3) / len(stds), 3))
        m.set("tl.motion_mean", round(float(np.mean(diffs)), 2) if diffs else 0)
        run, longest = 0, 0
        for d in diffs:
            run = run + 1 if d < 0.6 else 0
            longest = max(longest, run)
        m.set("tl.static_max_gap_s", round(longest / fs, 2))
        cut_thr = float(opts.get("cut_threshold", 22))
        cuts = sum(1 for d in diffs if d > cut_thr)
        m.set("tl.cuts", cuts)
        m.set("tl.cuts_per_10s", round(cuts / max(dur, 1e-6) * 10, 2))
        _contact_sheet(keep, art / "contact.jpg")
        m.artifacts["timeline_contact"] = str(art / "contact.jpg")

        # ---------- 节拍对齐 ----------
        beats_file = opts.get("beats")
        if beats_file and diffs:
            beats = (load_json(ctx.task_dir / beats_file) or {}).get("beats", [])
            arr = np.array(diffs)
            thr = arr.mean() + 1.0 * arr.std()
            peaks = [i for i in range(1, len(arr) - 1) if arr[i] >= arr[i - 1] and arr[i] >= arr[i + 1] and arr[i] > thr]
            tol = 1.0 / fs + 0.01
            hits = [min(abs((p + 1) / fs - b) for b in beats) <= tol for p in peaks] if beats else []
            m.set("tl.visual_accents", len(peaks))
            m.set("tl.beat_hit_ratio", round(sum(hits) / len(hits), 3) if hits else 0)

        # ---------- 文字 ----------
        if layouts:
            vis = [x for x in layouts if x["visible"] > 0]
            m.set("tl.text_frames", len(vis))
            m.set("tl.text_overlap_ratio", round(sum(1 for x in vis if x["overlaps"] > 0) / max(len(vis), 1), 3))
            m.set("tl.text_offscreen_ratio", round(sum(1 for x in vis if x["offscreen"] > 0) / max(len(vis), 1), 3))
            m.set("tl.multiline_ratio", round(sum(1 for x in vis if x["multiline"] > 0) / max(len(vis), 1), 3))

        # ---------- 确定性 ----------
        k = int(opts.get("determinism_samples", 6))
        rng = random.Random(7)
        pts = sorted(rng.uniform(0.05, 0.95) * dur for _ in range(k))
        first = {}
        for t in pts:
            seek(t)
            first[t] = thumb(page.screenshot(), (240, 135))
        same = 0
        for t in rng.sample(pts, len(pts)):
            seek(max(0.0, dur - t))
            seek(t)
            if float(np.mean(np.abs(thumb(page.screenshot(), (240, 135)) - first[t]))) < 0.5:
                same += 1
        m.set("tl.determinism_ratio", round(same / k, 3))

        # ---------- 定格节奏 ----------
        if opts.get("pose") and info["hasPose"]:
            ofps = float(info.get("fps") or 24)
            changes, frames = 0, 0
            for start in (0.25, 0.5, 0.75):
                prev = None
                for j in range(48):
                    t = start * dur + j / ofps
                    val = json.dumps(page.evaluate(f"(t) => window['{g}'].getPose(t)", t), sort_keys=True, default=str)
                    if prev is not None:
                        frames += 1
                        changes += val != prev
                    prev = val
            m.set("tl.pose_changes", changes)
            m.set("tl.pose_hold_ratio", round(1 - changes / max(frames, 1), 3))
        elif opts.get("pose"):
            m.set("tl.pose_hold_ratio", None)

        # ---------- 相机与镜头表 ----------
        shots = info.get("shots") or []
        if opts.get("camera") and info["hasCam"] and shots:
            ok = 0
            for s in shots:
                try:
                    mid = (float(s["start"]) + float(s["end"])) / 2
                    ok += page.evaluate(f"(t) => window['{g}'].cameraAt(t)", mid) == s.get("camera_id")
                except Exception:  # noqa: BLE001
                    pass
            m.set("tl.camera_match_ratio", round(ok / len(shots), 3))
        if opts.get("shots_json"):
            ref = (load_json(ctx.project_root() / opts["shots_json"]) or {}).get("shots", [])
            keys = ("id", "start", "end", "camera_id")
            norm = lambda s: tuple(round(float(s.get(k)), 2) if k in ("start", "end") and s.get(k) is not None else s.get(k) for k in keys)  # noqa: E731
            if ref and shots:
                a = [norm(s) for s in shots]
                b = [norm(s) for s in ref]
                m.set("tl.shots_json_match", round(sum(1 for x in a if x in b) / max(len(a), len(b)), 3))
            else:
                m.set("tl.shots_json_match", 0)

        # ---------- 评审用视频 ----------
        rv = opts.get("render_video")
        if rv and not ctx.fast and shutil.which("ffmpeg"):
            vfps = int(rv.get("fps", 24))
            fdir = art / "frames"
            if fdir.exists():
                shutil.rmtree(fdir)
            fdir.mkdir()
            for i in range(int(dur * vfps)):
                seek(i / vfps)
                (fdir / f"{i:05d}.jpg").write_bytes(page.screenshot(type="jpeg", quality=82))
            out = art / "review.mp4"
            cmd = ["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(vfps), "-i", str(fdir / "%05d.jpg")]
            audio = rv.get("audio")
            if audio and (ctx.task_dir / audio).exists():
                cmd += ["-i", str(ctx.task_dir / audio), "-shortest", "-c:a", "aac", "-b:a", "192k"]
            cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", str(out)]
            subprocess.run(cmd, check=False)
            shutil.rmtree(fdir, ignore_errors=True)
            if out.exists():
                m.artifacts["review_video"] = str(out)
        c.close()


def _contact_sheet(frames, path: Path) -> None:
    from PIL import Image, ImageDraw
    if not frames:
        return
    cols, w, h = 4, 480, 270
    rows = (len(frames) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * w, rows * (h + 24)), "black")
    d = ImageDraw.Draw(sheet)
    for i, (t, b) in enumerate(frames):
        im = Image.open(io.BytesIO(b)).convert("RGB").resize((w, h))
        x, y = (i % cols) * w, (i // cols) * (h + 24)
        sheet.paste(im, (x, y))
        d.text((x + 6, y + h + 4), f"t={t:.2f}s", fill="white")
    sheet.save(path, quality=85)
