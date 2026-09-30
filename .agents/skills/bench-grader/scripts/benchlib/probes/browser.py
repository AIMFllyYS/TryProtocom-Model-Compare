"""浏览器探针：加载、报错、网络请求、帧率、响应式、无障碍、3D 场景、音频、自定义 JS 指标。"""
from __future__ import annotations

import json
import time
from pathlib import Path

from ..common import RunContext
from .jslib import (FPS_JS, INIT_SCRIPT, SCENE_JS, TEXT_LAYOUT_JS, browser_session, distinct_count, thumb,
                    wrap_async)


def _flatten(prefix: str, val, out: dict) -> None:
    if isinstance(val, dict):
        for k, v in val.items():
            _flatten(f"{prefix}.{k}", v, out)
    elif isinstance(val, (list, tuple)):
        out[prefix] = list(val)
        out[prefix + ".len"] = len(val)
    else:
        out[prefix] = val


def _eval(page, code: str, arg=None, timeout_s=45):
    page.set_default_timeout(timeout_s * 1000)
    fn = wrap_async(code)
    return page.evaluate(fn, arg) if arg is not None else page.evaluate(fn)


def _open(ctxb, url: str, errors: list, requests: list, allowed_hosts: list[str]):
    page = ctxb.new_page()
    page.on("console", lambda msg: errors.append(("console", msg.text)) if msg.type == "error" else None)
    page.on("pageerror", lambda exc: errors.append(("pageerror", str(exc))))

    def on_req(req):
        u = req.url
        if u.startswith(("file:", "data:", "blob:", "about:")):
            return
        host = u.split("//", 1)[-1].split("/")[0]
        requests.append((u, any(host.endswith(h) for h in allowed_hosts)))

    page.on("request", on_req)
    page.goto(url, wait_until="load", timeout=60000)
    return page


def browser_probe(ctx: RunContext, opts: dict) -> None:
    m = ctx.metrics
    try:
        import playwright  # noqa: F401
    except ImportError:
        m.mark_na("browser.*", "未安装 playwright")
        return
    entry = ctx.project_root() / opts.get("entry", "index.html")
    if not entry.exists():
        cands = sorted(ctx.project_root().rglob(Path(opts.get("entry", "index.html")).name))
        cands = [c for c in cands if "node_modules" not in c.parts]
        if not cands:
            m.set("browser.loaded", False)
            return
        entry = cands[0]
    url = entry.resolve().as_uri() + opts.get("query", "")
    allowed = opts.get("allowed_hosts", [])
    art = ctx.work_dir / "screens"
    art.mkdir(exist_ok=True)
    errors, reqs = [], []
    vw, vh = opts.get("viewport", [1920, 1080])
    headless = (ctx.cfg.get("browser") or {}).get("headless", True)
    with browser_session(headless) as browser:
        c = browser.new_context(viewport={"width": vw, "height": vh})
        c.add_init_script(INIT_SCRIPT)
        t_load = time.time()
        try:
            page = _open(c, url, errors, reqs, allowed)
        except Exception as e:  # noqa: BLE001
            m.set("browser.loaded", False)
            m.notes.append(f"load failed: {e}")
            return
        m.set("browser.loaded", True)
        m.set("browser.load_s", round(time.time() - t_load, 2))

        if opts.get("first_frame"):
            m.set("browser.first_canvas_ms", _first_canvas(page, t_load))
        page.wait_for_timeout(opts.get("wait_ms", 2500))

        hooks = opts.get("hooks", [])
        present = {}
        for h in hooks:
            present[h] = bool(page.evaluate("(p) => { const v = p.split('.').reduce((o,k)=>o==null?undefined:o[k], window); return v !== undefined && v !== null; }", h))
            m.set(f"browser.hook.{h}", present[h])
        if hooks:
            m.set("browser.hooks_ratio", sum(present.values()) / len(hooks))

        for setup in opts.get("before", []):
            try:
                _eval(page, setup)
                page.wait_for_timeout(800)
            except Exception as e:  # noqa: BLE001
                m.notes.append(f"before step failed: {e}")

        if opts.get("fps", True):
            r = page.evaluate(FPS_JS, int(opts.get("fps_ms", 3000)))
            m.set("browser.fps", round(r["fps"], 1))
            m.set("browser.worst_frame_ms", round(r["worst_frame_ms"], 1))
        png = page.screenshot()
        (art / "desktop.png").write_bytes(png)
        m.artifacts["desktop"] = str(art / "desktop.png")
        lay = page.evaluate(TEXT_LAYOUT_JS)
        m.set("browser.text_overlaps", lay["overlaps"])
        m.set("browser.text_offscreen", lay["offscreen"])

        if opts.get("scene"):
            sc = opts["scene"]
            for s in sc.get("setup", []):
                try:
                    _eval(page, s)
                    page.wait_for_timeout(1200)
                except Exception as e:  # noqa: BLE001
                    m.notes.append(f"scene setup failed: {e}")
            info = page.evaluate(SCENE_JS, {"scene": sc.get("path", "__scene"), "renderer": sc.get("renderer", "__renderer"), "prefixes": sc.get("prefixes", [])})
            if info is None:
                m.set("scene.available", False)
            else:
                m.set("scene.available", True)
                flat = {}
                _flatten("scene", info, flat)
                for k, v in flat.items():
                    m.set(k, v)
                for p in sc.get("prefixes", []):
                    m.values.setdefault(f"scene.named.{p}", 0)
                if sc.get("fps_label"):
                    r = page.evaluate(FPS_JS, 2500)
                    m.set(f"browser.fps_{sc['fps_label']}", round(r["fps"], 1))

        for name, code in (opts.get("js_metrics") or {}).items():
            try:
                val = _eval(page, code)
                flat = {}
                _flatten(f"js.{name}", val, flat)
                for k, v in flat.items():
                    m.set(k, v)
            except Exception as e:  # noqa: BLE001
                m.notes.append(f"js metric {name} failed: {str(e)[:300]}")

        for name, spec in (opts.get("shot_sets") or {}).items():
            thumbs = []
            for i, step in enumerate(spec.get("steps", [])):
                try:
                    _eval(page, step)
                except Exception as e:  # noqa: BLE001
                    m.notes.append(f"shot_set {name} step {i} failed: {str(e)[:200]}")
                    continue
                page.wait_for_timeout(spec.get("wait_ms", 1500))
                b = page.screenshot()
                (art / f"{name}_{i}.png").write_bytes(b)
                thumbs.append(thumb(b))
            m.set(f"shots.{name}.distinct", distinct_count(thumbs) if thumbs else 0)
            m.artifacts[f"shots_{name}"] = str(art / f"{name}_*.png")

        if opts.get("audio", False):
            before = page.evaluate("() => window.__probe")
            m.set("audio.ctx_before_gesture", before["ctxBeforeGesture"])
            sel = opts.get("audio_click")
            try:
                if sel:
                    page.click(sel, timeout=5000)
                else:
                    page.mouse.click(vw * 0.5, vh * 0.5)
            except Exception as e:  # noqa: BLE001
                m.notes.append(f"audio click failed: {e}")
            page.wait_for_timeout(2500)
            after = page.evaluate("() => window.__probe")
            m.set("audio.ctx_created", after["ctxCreated"])
            m.set("audio.nodes", after["nodes"])
            m.set("audio.oscillators", after["osc"])

        for name, steps in (opts.get("sequences") or {}).items():
            val = None
            try:
                for st in steps:
                    if st.get("reload"):
                        page.reload(wait_until="load")
                        page.wait_for_timeout(1500)
                    if st.get("js"):
                        val = _eval(page, st["js"])
                    if st.get("wait"):
                        page.wait_for_timeout(st["wait"])
                flat = {}
                _flatten(f"seq.{name}", val, flat)
                for k, v in flat.items():
                    m.set(k, v)
            except Exception as e:  # noqa: BLE001
                m.notes.append(f"sequence {name} failed: {str(e)[:300]}")

        axe_path = (ctx.cfg.get("external") or {}).get("axe_core_js")
        if opts.get("axe"):
            if axe_path and Path(axe_path).expanduser().exists():
                page.add_script_tag(path=str(Path(axe_path).expanduser()))
                res = page.evaluate("async () => { const r = await axe.run(document, {resultTypes: ['violations']}); return r.violations.map(v => ({id: v.id, impact: v.impact, n: v.nodes.length})); }")
                serious = sum(v["n"] for v in res if v["impact"] in ("serious", "critical"))
                m.set("a11y.serious_nodes", serious)
                m.set("a11y.rules_violated", len(res))
                (ctx.work_dir / "axe.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
            else:
                m.mark_na("a11y.*", "未配置 external.axe_core_js")
        c.close()

        if opts.get("mobile"):
            mc = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
            mc.add_init_script(INIT_SCRIPT)
            merr, mreq = [], []
            try:
                mp = _open(mc, url, merr, mreq, allowed)
                mp.wait_for_timeout(2500)
                ov = mp.evaluate("() => Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0) - innerWidth")
                m.set("mobile.overflow_px", max(0, int(ov)))
                lay = mp.evaluate(TEXT_LAYOUT_JS)
                m.set("mobile.text_offscreen", lay["offscreen"])
                m.set("mobile.text_overlaps", lay["overlaps"])
                b = mp.screenshot()
                (art / "mobile.png").write_bytes(b)
                m.artifacts["mobile"] = str(art / "mobile.png")
                errors.extend(merr)
                reqs.extend(mreq)
            except Exception as e:  # noqa: BLE001
                m.notes.append(f"mobile load failed: {e}")
                m.set("mobile.overflow_px", 9999)
            mc.close()

    m.set("browser.console_errors", sum(1 for k, _ in errors if k == "console"))
    m.set("browser.page_errors", sum(1 for k, _ in errors if k == "pageerror"))
    m.set("browser.errors_total", len(errors))
    m.set("browser.external_requests", sum(1 for _, ok in reqs if not ok))
    m.set("browser.requests_total", len(reqs))
    (ctx.work_dir / "browser_errors.json").write_text(json.dumps(errors[:200], ensure_ascii=False, indent=1), encoding="utf-8")
    (ctx.work_dir / "browser_requests.json").write_text(json.dumps(reqs[:200], ensure_ascii=False, indent=1), encoding="utf-8")


def _first_canvas(page, t0: float, timeout_s: float = 10.0):
    """首个非空 canvas 画面出现的时间（毫秒，从开始加载算）。"""
    import numpy as np
    end = time.time() + timeout_s
    while time.time() < end:
        try:
            el = page.query_selector("canvas")
            if el:
                b = el.screenshot(timeout=3000)
                if float(np.std(thumb(b))) > 4:
                    return int((time.time() - t0) * 1000)
        except Exception:  # noqa: BLE001
            pass
        page.wait_for_timeout(200)
    return None
