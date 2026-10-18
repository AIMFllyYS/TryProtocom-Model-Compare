"""capture / scene_audit / voxel_audit 探针：用“鸭子类型”的假 three 场景在真实 Chromium 里验证。

没有 playwright 或浏览器时整体跳过（与评测机能力一致）。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from benchlib.common import Metrics, RunContext  # noqa: E402
from benchlib.probes import capture  # noqa: E402

try:
    from playwright.sync_api import sync_playwright
    from benchlib.probes.jslib import browser_session
    with browser_session(True):
        pass
    HAVE_BROWSER = True
except Exception:  # noqa: BLE001
    HAVE_BROWSER = False

pytestmark = pytest.mark.skipif(not HAVE_BROWSER, reason="需要 playwright + Chromium")

FAKE_THREE = r"""
class V { constructor(x,y,z){this.x=x;this.y=y;this.z=z;} }
class Obj {
  constructor(name){ this.name=name||''; this.parent=null; this.children=[]; this.visible=true; this.matrixWorld={elements:[1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]}; }
  add(o){ o.parent=this; this.children.push(o); return this; }
  traverse(f){ f(this); for(const c of this.children) c.traverse(f); }
  updateMatrixWorld(){}
  setPos(x,y,z){ const e=this.matrixWorld.elements; e[12]=x; e[13]=y; e[14]=z; return this; }
}
function boxGeo(w,h,d){
  const hx=w/2,hy=h/2,hz=d/2;
  const P=[[-hx,-hy,-hz],[hx,-hy,-hz],[hx,hy,-hz],[-hx,hy,-hz],[-hx,-hy,hz],[hx,-hy,hz],[hx,hy,hz],[-hx,hy,hz]];
  const I=[0,2,1,0,3,2, 4,5,6,4,6,7, 0,4,7,0,7,3, 1,2,6,1,6,5, 3,7,6,3,6,2, 0,1,5,0,5,4];
  return { attributes:{position:{count:8,getX:i=>P[i][0],getY:i=>P[i][1],getZ:i=>P[i][2]}}, index:{count:I.length,getX:i=>I[i]},
           boundingBox:{min:new V(-hx,-hy,-hz),max:new V(hx,hy,hz)} };
}
class Mesh extends Obj { constructor(name,geo){ super(name); this.isMesh=true; this.geometry=geo; this.material={uuid:'m'+name,color:{getHexString:()=>'aabbcc'}}; } }
class Instanced extends Obj {
  constructor(name,geo,mats){ super(name); this.isInstancedMesh=true; this.isMesh=true; this.geometry=geo; this.count=mats.length;
    this.instanceMatrix={array:new Float32Array(mats.flatMap(([x,y,z])=>[1,0,0,0,0,1,0,0,0,0,1,0,x,y,z,1]))}; this.material={uuid:'inst',color:{getHexString:()=>'123456'}}; }
}
window.Obj=Obj; window.Mesh=Mesh; window.Instanced=Instanced; window.boxGeo=boxGeo;
"""


def _write(tmp: Path, body: str) -> None:
    (tmp / "output").mkdir(exist_ok=True)
    (tmp / "output" / "index.html").write_text(
        "<!doctype html><meta charset=utf-8><body style='margin:0;background:#222'>"
        "<canvas id=c width=1280 height=720 style='width:100vw;height:100vh;display:block'></canvas><script>"
        + FAKE_THREE + body + "</script>", encoding="utf-8")


def _ctx(tmp: Path, rubric: dict) -> RunContext:
    rubric = {"deliverable_dir": "", "_dir": str(tmp), **rubric}
    return RunContext(run_dir=tmp, meta={}, rubric=rubric, cfg={"browser": {"headless": True}}, metrics=Metrics())


VIEWS_PAGE = r"""
const cv=document.getElementById('c'), g=cv.getContext('2d');
let hue=0, yaw=0;
function draw(){ g.fillStyle='hsl('+hue+',60%,'+((hue<100?15:55)+yaw%30)+'%)'; g.fillRect(0,0,1280,720); g.fillStyle='#fff'; g.fillRect(100+yaw*3,200,300,200); for(let i=0;i<40;i++){g.fillStyle='hsl('+(hue+i*7)+',70%,50%)'; g.fillRect(i*30,600,20,50+(i*yaw)%80);} }
draw();
window.__bench = { views:['a','b','dead'], setView(id){ if(id==='dead') return; hue = {a:20,b:200}[id]; draw(); } };
let down=false,lx=0;
cv.addEventListener('mousedown',e=>{down=true;lx=e.clientX});
addEventListener('mouseup',()=>down=false);
addEventListener('mousemove',e=>{ if(down){ yaw+=Math.abs(e.clientX-lx)*0.3; lx=e.clientX; draw(); } });
const root=new Obj('root'); root.add(new Obj('Frame')).add(new Obj('Chain')); window.__scene=root;
window.__bench.listParts=()=>[{id:'p1',name:'Frame',parent:null},{id:'p2',name:'Front fork',parent:'p1'}];
"""


def test_capture_views_orbit_parts(tmp_path):
    _write(tmp_path, VIEWS_PAGE)
    ctx = _ctx(tmp_path, {"capture": {
        "views": [{"id": "a"}, {"id": "b"}], "orbit": {"frames": 3}, "settle_ms": 200,
        "expected_parts": [{"id": "frame", "module": "frame", "re": "frame"}, {"id": "fork", "module": "steer", "re": "fork"},
                            {"id": "chain", "module": "drive", "re": "chain"}, {"id": "nope", "module": "drive", "re": "derailleur"}]}})
    capture.capture_probe(ctx, {"wait_ms": 300})
    v = ctx.metrics.values
    assert v["capture.default_nonblank"] is True
    assert v["capture.views_rendered_ratio"] == 1.0
    assert v["capture.views_distinct_ratio"] == 1.0
    assert v["capture.orbit_ok"] is True
    assert v["capture.expected.frame"] == 1.0 and v["capture.expected.steer"] == 1.0 and v["capture.expected.drive"] == 0.5
    manifest = json.loads((ctx.work_dir / "capture" / "manifest.json").read_text(encoding="utf-8"))
    assert [r["id"] for r in manifest["views"]] == ["a", "b"] and len(manifest["orbit"]) == 4


def test_capture_missing_hooks_scores_zero(tmp_path):
    _write(tmp_path, "const g=document.getElementById('c').getContext('2d'); g.fillStyle='#f0f'; g.fillRect(0,0,640,360);")
    ctx = _ctx(tmp_path, {"capture": {"views": [{"id": "a"}, {"id": "b"}], "settle_ms": 100}})
    capture.capture_probe(ctx, {"wait_ms": 200})
    assert ctx.metrics.values["capture.views_rendered_ratio"] == 0.0


RIG_PAGE = r"""
const root=new Obj('pelican');
const body=new Mesh('body',boxGeo(2,1,1)).setPos(0,1,0);
const head=new Mesh('head',boxGeo(0.6,0.6,0.6)).setPos(1.2,1.6,0);
const wheel=new Mesh('front-wheel',boxGeo(1,1,0.2)).setPos(1,0.5,0.6);
const ground=new Mesh('ground',boxGeo(50,0.1,50)).setPos(0,-0.05,0);
for (const m of [body,head,wheel]) root.add(m);
root.add(ground);
window.__scene=root;
window.__setHeadFar=(on)=>{ head.setPos(on?6:1.2, on?5:1.6, 0); };
window.FILM={seek(t){ window.__setHeadFar(t>=5); }};
window.__bench={views:[],setView(){}};
"""


def test_rig_floating_and_contacts_and_seek(tmp_path):
    _write(tmp_path, RIG_PAGE)
    rubric = {"capture": {"contacts": [{"a": "wheel", "b": "ground", "tol": 0.02, "label": "轮-地"}, {"a": "head", "b": "ground", "tol": 0.02, "label": "头-地"}, {"a": "tail", "b": "ground"}],
                          "motion": {"seek": "FILM.seek", "times": [0, 6]}}}
    ctx = _ctx(tmp_path, rubric)
    capture.scene_audit_probe(ctx, {"wait_ms": 200})
    v = ctx.metrics.values
    assert v["rig.floating_ratio"] == 0.0          # 初始姿态：头贴着身体
    assert v["rig.motion_floating_max"] > 0.2        # t=6：头飞走了
    assert v["rig.subject_parts"] == 3               # 地面被识别为环境
    assert v["rig.contacts_ok_ratio"] == pytest.approx(1 / 3)  # 轮-地成立；头-地不成立；tail 不存在
    assert v["rig.contacts_found_ratio"] == pytest.approx(2 / 3)


def test_rig_deep_clip(tmp_path):
    _write(tmp_path, r"""
const root=new Obj('r'); root.add(new Mesh('torso',boxGeo(1,1,1)).setPos(0,0.5,0));
root.add(new Mesh('arm',boxGeo(0.95,0.95,0.95)).setPos(0.02,0.5,0)); root.add(new Mesh('leg',boxGeo(0.4,1,0.4)).setPos(0,-0.5,0));
window.__scene=root;""")
    ctx = _ctx(tmp_path, {"capture": {}})
    capture.scene_audit_probe(ctx, {"wait_ms": 200})
    assert ctx.metrics.values["rig.deep_clip_ratio"] >= 0.6


def test_rig_not_three_is_na(tmp_path):
    _write(tmp_path, "document.title='svg only'")
    ctx = _ctx(tmp_path, {"capture": {}})
    capture.scene_audit_probe(ctx, {"wait_ms": 100, "wait_s": 1})
    assert ctx.metrics.is_na("rig.floating_ratio")


def _grid_instances(n, off=(0, 0, 0), jitter=0.0):
    import random
    rnd = random.Random(3)
    out = []
    for x in range(n):
        for z in range(n):
            out.append([x + off[0] + rnd.uniform(-jitter, jitter), 0 + off[1], z + off[2] + rnd.uniform(-jitter, jitter)])
    return out


def test_voxel_instanced_hollow_tower(tmp_path):
    # 地面 12x12；其上一座 8x8x6 的空心塔（四面墙 + 屋顶），墙厚 1
    cells = [[x, 0, z] for x in range(12) for z in range(12)]
    for y in range(1, 7):
        for x in range(2, 10):
            for z in range(2, 10):
                edge = x in (2, 9) or z in (2, 9) or y == 6
                if edge:
                    cells.append([x, y, z])
    _write(tmp_path, "const geo=boxGeo(1,1,1); const root=new Obj('w'); root.add(new Instanced('blocks',geo,%s)); window.__scene=root; window.__bench={blockSize:1,views:[],setView(){}};" % json.dumps(cells))
    ctx = _ctx(tmp_path, {})
    capture.voxel_audit_probe(ctx, {"wait_ms": 200, "block_size_from": "__bench.blockSize"})
    v = ctx.metrics.values
    assert v["voxel.available"] is True
    assert v["voxel.aligned_ratio"] > 0.99 and v["voxel.uniform_ratio"] > 0.99
    assert v["voxel.extent_x"] == 8 and v["voxel.extent_z"] == 8 and v["voxel.extent_y"] == 6
    assert v["voxel.height_levels"] == 6
    assert v["voxel.interior_void_ratio"] > 0.3  # 内部 6x6x5 空腔 / 8x8x6


def test_voxel_jittered_blocks_fail_alignment(tmp_path):
    cells = _grid_instances(14, jitter=0.35)
    cells += [[c[0], 1, c[2]] for c in cells[:60]]
    _write(tmp_path, "const geo=boxGeo(1,1,1); const root=new Obj('w'); root.add(new Instanced('blocks',geo,%s)); window.__scene=root;" % json.dumps(cells))
    ctx = _ctx(tmp_path, {})
    capture.voxel_audit_probe(ctx, {"wait_ms": 200})
    assert ctx.metrics.values["voxel.aligned_ratio"] < 0.6


def test_voxel_merged_mesh_faces(tmp_path):
    # 用多个 1x1x1 普通网格（每个自带 12 个三角形）摆成 5x5x3 的实心体 → 通过外露面推出格子
    body = """const root=new Obj('w'); for(let x=0;x<5;x++)for(let y=0;y<3;y++)for(let z=0;z<5;z++){ root.add(new Mesh('b',boxGeo(1,1,1)).setPos(x,y,z)); } window.__scene=root;"""
    _write(tmp_path, body)
    ctx = _ctx(tmp_path, {})
    capture.voxel_audit_probe(ctx, {"wait_ms": 200, "min_blocks": 20})
    v = ctx.metrics.values
    assert v["voxel.available"] is True
    assert v["voxel.aligned_ratio"] > 0.99
    assert v["voxel.uniform_ratio"] > 0.99


def test_voxel_not_available_without_scene(tmp_path):
    _write(tmp_path, "document.title='x'")
    ctx = _ctx(tmp_path, {})
    capture.voxel_audit_probe(ctx, {"wait_ms": 100, "wait_s": 1})
    assert ctx.metrics.values["voxel.available"] is False
