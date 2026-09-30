"""注入页面的 JS 片段与浏览器启动工具（browser / timeline 探针共用）。"""
from __future__ import annotations

import io
import os
from contextlib import contextmanager

INIT_SCRIPT = r"""
(() => {
  const w = window;
  w.__probe = {ctxCreated: 0, ctxBeforeGesture: 0, nodes: 0, osc: 0, gesture: false};
  const mark = () => { w.__probe.gesture = true; };
  addEventListener('pointerdown', mark, true);
  addEventListener('mousedown', mark, true);
  addEventListener('keydown', mark, true);
  addEventListener('touchstart', mark, true);
  const methods = ['createOscillator','createGain','createBiquadFilter','createBufferSource','createBuffer',
    'createDelay','createConvolver','createDynamicsCompressor','createStereoPanner','createWaveShaper','createAnalyser'];
  for (const name of ['AudioContext', 'webkitAudioContext']) {
    const C = w[name];
    if (!C) continue;
    const Wrapped = function (...a) {
      const c = new C(...a);
      w.__probe.ctxCreated++;
      if (!w.__probe.gesture) w.__probe.ctxBeforeGesture++;
      for (const f of methods) {
        if (typeof c[f] === 'function') {
          const orig = c[f].bind(c);
          c[f] = (...x) => { w.__probe.nodes++; if (f === 'createOscillator') w.__probe.osc++; return orig(...x); };
        }
      }
      return c;
    };
    Wrapped.prototype = C.prototype;
    try { w[name] = Wrapped; } catch (e) {}
  }
})();
"""

TEXT_LAYOUT_JS = r"""
() => {
  const vw = innerWidth, vh = innerHeight;
  const byEl = new Map();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const visibleOpacity = (el) => {
    let a = el, op = 1;
    while (a && a.nodeType === 1) {
      const s = getComputedStyle(a);
      if (s.display === 'none' || s.visibility === 'hidden') return 0;
      op *= parseFloat(s.opacity || '1');
      a = a.parentElement;
    }
    return op;
  };
  while (walker.nextNode()) {
    const n = walker.currentNode;
    const t = n.textContent.trim();
    if (!t) continue;
    const el = n.parentElement;
    if (!el || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TITLE'].includes(el.tagName)) continue;
    if (visibleOpacity(el) < 0.05) continue;
    const r = document.createRange();
    r.selectNodeContents(n);
    const rects = [...r.getClientRects()].filter(x => x.width > 1 && x.height > 1);
    if (!rects.length) continue;
    const e = byEl.get(el) || {rects: [], text: ''};
    e.rects.push(...rects); e.text += t; byEl.set(el, e);
  }
  const boxes = [];
  let offscreen = 0, multiline = 0, visible = 0;
  for (const [el, e] of byEl) {
    const xs = e.rects;
    const L = Math.min(...xs.map(r => r.left)), T = Math.min(...xs.map(r => r.top));
    const R = Math.max(...xs.map(r => r.right)), B = Math.max(...xs.map(r => r.bottom));
    if (R < 0 || B < 0 || L > vw || T > vh) continue;
    visible++;
    if (L < -1 || T < -1 || R > vw + 1 || B > vh + 1) offscreen++;
    const tops = new Set(xs.map(r => Math.round(r.top / 6)));
    if (/[一-鿿]/.test(e.text) && tops.size > 1 && e.text.length <= 40) multiline++;
    boxes.push({el, L, T, R, B, a: Math.max((R - L) * (B - T), 1)});
  }
  let overlaps = 0;
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const p = boxes[i], q = boxes[j];
    if (p.el.contains(q.el) || q.el.contains(p.el)) continue;
    const w = Math.min(p.R, q.R) - Math.max(p.L, q.L), h = Math.min(p.B, q.B) - Math.max(p.T, q.T);
    if (w > 2 && h > 2 && w * h > 0.15 * Math.min(p.a, q.a)) overlaps++;
  }
  return {overlaps, offscreen, multiline, visible};
}
"""

SCENE_JS = r"""
(args) => {
  const get = (path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), window);
  const sc = get(args.scene); const r = args.renderer ? get(args.renderer) : null;
  if (!sc || typeof sc.traverse !== 'function') return null;
  let meshes = 0, tris = 0, pbr = 0, matCount = 0, casters = 0, receivers = 0, lights = 0, shadowLights = 0, tex = 0, procTex = 0, instanced = 0;
  const named = {}; const seen = new Set(); const prefixes = args.prefixes || [];
  sc.traverse(o => {
    if (o.isLight) { lights++; if (o.castShadow) shadowLights++; }
    for (const p of prefixes) if (o.name && o.name.startsWith(p)) named[p] = (named[p] || 0) + 1;
    if (!(o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || o.isPoints)) return;
    meshes++;
    if (o.isInstancedMesh) instanced++;
    const g = o.geometry;
    if (g && g.attributes && g.attributes.position) {
      const n = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
      tris += n * (o.isInstancedMesh ? o.count : 1);
    }
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      matCount++;
      if (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) pbr++;
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'bumpMap', 'alphaMap']) {
        const t = m[k];
        if (t && !seen.has(t.uuid)) {
          seen.add(t.uuid); tex++;
          const img = t.image;
          if (t.isCanvasTexture || t.isDataTexture || (img && (img instanceof HTMLCanvasElement || img.data))) procTex++;
        }
      }
    }
    if (o.castShadow) casters++;
    if (o.receiveShadow) receivers++;
  });
  const out = {meshes, triangles: Math.round(tris), materials: matCount, pbr_ratio: matCount ? pbr / matCount : 0,
    shadow_casters: casters, shadow_receivers: receivers, lights, shadow_lights: shadowLights, textures: tex,
    procedural_textures: procTex, instanced, named};
  if (r) {
    out.shadowmap = !!(r.shadowMap && r.shadowMap.enabled);
    out.tonemapping = r.toneMapping ? 1 : 0;
    out.draw_calls = r.info && r.info.render ? r.info.render.calls : null;
    out.programs = r.info && r.info.programs ? r.info.programs.length : null;
  }
  return out;
}
"""

FPS_JS = r"""
async (ms) => {
  let n = 0, worst = 0, last = performance.now();
  const t0 = last;
  await new Promise(res => {
    const tick = (t) => { n++; worst = Math.max(worst, t - last); last = t; if (t - t0 < ms) requestAnimationFrame(tick); else res(); };
    requestAnimationFrame(tick);
  });
  return {fps: n * 1000 / (performance.now() - t0), worst_frame_ms: worst};
}
"""


def wrap_async(code: str) -> str:
    """把 rubric 中写的 JS（函数体或箭头函数）包装成可 evaluate 的异步函数。"""
    c = code.strip()
    if c.startswith("async") or c.startswith("(") or c.startswith("function"):
        return c
    return "async () => { const sleep = (ms) => new Promise(r => setTimeout(r, ms));\n" + c + "\n}"


def launch_args() -> list[str]:
    return ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist",
            "--autoplay-policy=user-gesture-required"]


@contextmanager
def browser_session(headless: bool = True):
    from playwright.sync_api import sync_playwright
    exe = os.environ.get("BENCH_CHROMIUM")
    with sync_playwright() as p:
        kw = {"headless": headless, "args": launch_args()}
        if exe:
            kw["executable_path"] = exe
        b = p.chromium.launch(**kw)
        try:
            yield b
        finally:
            b.close()


def thumb(png_bytes: bytes, size=(96, 54)):
    from PIL import Image
    import numpy as np
    im = Image.open(io.BytesIO(png_bytes)).convert("L").resize(size)
    return np.asarray(im, dtype="float32")


def distinct_count(thumbs, thr=6.0) -> int:
    import numpy as np
    reps = []
    for t in thumbs:
        if all(float(np.mean(np.abs(t - r))) > thr for r in reps):
            reps.append(t)
    return len(reps)
