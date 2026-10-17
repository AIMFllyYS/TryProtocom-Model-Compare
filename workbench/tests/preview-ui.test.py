"""Headless UI regression against an isolated fixture API; never writes benchmark data.
Run after npm run build: python tests/preview-ui.test.py
"""
import copy
import json
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "workbench/dist"
OUT = ROOT / "workbench/.runtime/preview-ui"
OUT.mkdir(parents=True, exist_ok=True)
keys = ["T01", "T02", "T03A", "T03C", "T04", "T05", "T06", "T07", "T08"]
item = dict(id="H1", dim="ui", tier="basic", tier_label="基础", method="human", method_label="人工", weight=1, desc="测试交互与视觉表现", metric="", rule="", anchors=["0 分", "1 分", "2 分", "3 分"], evidence="查看产物", variants=[])
spec = dict(cfg=dict(name="UI regression",version="1",runs_per_task=3), dims=[dict(id="ui",name="UI",kind="quality")],tasks=[dict(id=f"T{i:02}",name=f"Fixture task {i}",short=f"T{i:02}",variants={"A":{},"C":{}} if i==3 else {},items=[item],dims={"ui":1},condition="",materials=[],prompt="",gates=[],hidden=[]) for i in range(1,9)],relations=[])
store = dict(schema="bench-store/1",created_at="2026-01-01",updated_at="2026-01-01",benchmark={"name":"UI regression"},settings={},notes=[],history=[],trash=[])
template = dict(harness="test",alias=None,graded=True,manual={},usage={},artifacts={},notes=[],dir="",has_final_message=True,synced_at="2026-01-01",score=dict(total=90,complete=True,gate_pass=True,gate_fail=[],passed=True,dims={"ui":90},dim_weights={"ui":1},tiers={},na_ratio=0,low_confidence=False,pending=["H1"],items=[{**item,"status":"pending","s":None}]))
models = ["UI Alpha", "UI Beta", "UI Gamma"]
runs, workspaces = [], []
for model in models:
    for key in keys:
        for index, total in [(1, 50), (2, 90), (3, 90)]:
            run = copy.deepcopy(template)
            ref = f"Test/{model}/{key}/r{index}"
            run.update(run_id=f"{model}-{key}-r{index}", entrant=model+" @ test", model=model, vendor="Test", task=key[:3], variant=key[3:] or None, tkey=key, run_index=index, ws_ref=ref, artifacts={})
            run["score"]["total"] = total
            runs.append(run)
            workspaces.append(dict(schema=1, ref=ref, model=model, vendor="Test", task=key[:3], variant=key[3:] or None, tkey=key, index=index, harness="test", grader_run_id=run["run_id"], entry="index.html", deliverable_dir="", created_at="2026-01-01", started_at=None, ended_at=None, usage={}))
store.update(runs=runs, workspaces=workspaces, models=[dict(vendor="Test", name=m, schema=1, created_at="2026-01-01") for m in models])
board = [dict(entrant=m+" @ test", model=m, harness="test", vendor="Test", rank=str(i+1), quality=80, dims={}, pass_rate=1, suite_exp_cost_usd=1, suite_exp_min=1) for i,m in enumerate(models)]
aggregate = dict(board=board, entrants=[b["entrant"] for b in board], tkeys=keys, tasks=[], items=[], uplift=[], failures=[], pending={})
sessions = []
preview_requests = []
unexpected_writes = []
file_reads = []
def ent(path, directory=False):
    return dict(path=path,name=path.split('/')[-1],dir=directory,size=64,mtime=0)
file_dirs = {"": [ent("model", True),ent("workbench",True),ent("README.md")], "model": [ent("model/Alpha",True)], "model/Alpha": [ent("model/Alpha/T01",True)], "model/Alpha/T01": [ent("model/Alpha/T01/r1",True)], "model/Alpha/T01/r1": [ent("model/Alpha/T01/r1/index.html"),ent("model/Alpha/T01/r1/notes.txt")], "workbench/.runtime": [ent("workbench/.runtime/snapshot.json")]}


def session(sid, label, base):
    return dict(id=sid, kind="url", label=label, url=base+"/test-artifact", inject=False, created_at=1, counts=dict(error=0, warn=0, log=0, failed=0))

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
    def handle(self):
        try: super().handle()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError): pass
    def send_json(self, value, code=200):
        data=json.dumps(value).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length",str(len(data))); self.end_headers(); self.wfile.write(data)
    def do_GET(self):
        path=urlparse(self.path).path
        if path=="/api/fs/list":
            directory=parse_qs(urlparse(self.path).query,keep_blank_values=True).get("path",[""])[0]
            file_reads.append(directory)
            self.send_json(dict(entries=file_dirs.get(directory,[]))); return
        if path=="/api/fs/read":
            name=parse_qs(urlparse(self.path).query)["path"][0]
            self.send_json(dict(text="Content of "+name,truncated=False,binary=False)); return
        if path=="/test-artifact":
            data=b"<!doctype html><html><body style='background:#e6eff6;font:24px sans-serif'><h1>Interactive artifact</h1><button onclick='this.textContent=\"Clicked\"'>Test interaction</button></body></html>"
            self.send_response(200); self.send_header("Content-Type","text/html"); self.end_headers(); self.wfile.write(data); return
        values={"/api/session":dict(token="fixture",desktop=False,root=str(ROOT),version="test"), "/api/spec":spec, "/api/store":store, "/api/aggregate":aggregate, "/api/preview":sessions, "/api/jobs":[], "/api/procs":[], "/api/harness":[]}
        if path=="/api/events":
            self.send_response(200); self.send_header("Content-Type","text/event-stream"); self.end_headers()
            for item in sessions: self.wfile.write(("data: "+json.dumps(dict(type="session",id=item["id"],session=item))+"\n\n").encode())
            return
        if path in values: self.send_json(values[path]); return
        if path.startswith("/api/"): self.send_json([]); return
        super().do_GET()
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers.get("Content-Length","0"))) or "{}")
        if self.path=="/api/preview":
            preview_requests.append(body)
            item=session("fixture-"+str(len(sessions)),body.get("label","Artifact"),base)
            sessions.append(item); self.send_json(item); return
        unexpected_writes.append(self.path); self.send_json({"error":"Unexpected write"},403)

server=ThreadingHTTPServer(("127.0.0.1",0),partial(Handler,directory=str(DIST)))
base=f"http://127.0.0.1:{server.server_port}"
threading.Thread(target=server.serve_forever,daemon=True).start()
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        page=browser.new_page(viewport={"width":1440,"height":1000})
        errors=[]
        page.on("pageerror",lambda e: errors.append(str(e)))
        page.goto(base+"/#/compare")
        page.wait_for_load_state("networkidle")
        expect(page.locator(".artifact-task")).to_have_count(9)
        expect(page.locator(".artifact-tile")).to_have_count(18)
        assert all("r2" in text for text in page.locator(".artifact-tile-meta").all_text_contents())
        assert len(preview_requests) <= 4, preview_requests
        first=page.locator(".artifact-task").first
        expect(first.locator("iframe")).to_have_count(2)
        first.locator("iframe").first.content_frame.get_by_role("button",name="Test interaction").click()
        expect(first.locator("iframe").first.content_frame.get_by_role("button",name="Clicked")).to_be_visible()
        page.screenshot(path=str(OUT/"compare.png"))
        page.get_by_role("button",name="交换左右",exact=True).click()
        expect(first.locator(".artifact-tile-meta").first).to_contain_text("UI Beta")
        # Every task is present before scrolling; offscreen iframe execution is bounded.
        last=page.locator(".artifact-task").last
        last.scroll_into_view_if_needed()
        expect(last.locator("iframe")).to_have_count(2)
        expect(first.locator("iframe")).to_have_count(0)
        assert page.locator("iframe").count() <= 6
        last.get_by_role("button",name="放大对比").click()
        dialog=page.get_by_role("dialog")
        expect(dialog.locator("iframe")).to_have_count(2)
        expect(page.locator(".artifact-task iframe")).to_have_count(0)
        page.screenshot(path=str(OUT/"expanded.png"))
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        expect(last.locator("iframe")).to_have_count(2)
        page.get_by_role("radio",name="图表数据",exact=True).click()
        expect(page.get_by_role("table")).to_have_count(2)
        expect(page.locator("iframe")).to_have_count(0)
        page.get_by_role("radio",name="产物平铺",exact=True).click()
        expect(page.locator(".artifact-task")).to_have_count(9)
        page.get_by_role("button",name="右侧模型",exact=True).click()
        page.get_by_role("option").filter(has_text="UI Gamma @ test").click()
        expect(page.locator(".artifact-tile-meta").nth(1)).to_contain_text("UI Gamma")
        expect(page.locator(".artifact-tile")).to_have_count(18)
        # Narrow screen keeps both columns aligned without page overflow.
        page.set_viewport_size({"width":780,"height":900})
        expect(page.locator(".artifact-task")).to_have_count(9)
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        page.screenshot(path=str(OUT/"narrow.png"))
        page.set_viewport_size({"width":1440,"height":1000})
        # Stage fixture: five tabs must survive, only four panes execute.
        sessions.extend(session(f"stage-{i}",f"Stage tab {i}",base) for i in range(5))
        panes=[dict(id=f"tab-{i}",src=dict(type="session",sid=f"stage-{i}"),device="fill",zoom="fit",rotate=False,devtools=False) for i in range(5)]
        page.evaluate("([panes,score]) => {localStorage.setItem('wb.stage.panes',JSON.stringify(panes));localStorage.setItem('wb.stage.score',JSON.stringify(score));localStorage.setItem('wb.stage.layout',JSON.stringify('cols'));}",[panes,runs[0]["run_id"]])
        page.goto(base+"/#/stage")
        page.reload()
        expect(page.locator(".stage-tab")).to_have_count(5)
        expect(page.locator(".stage-grid .pane")).to_have_count(4)
        tab=page.get_by_role("button",name="Stage tab 0",exact=True)
        tab.click(button="right")
        menu=page.get_by_role("dialog",name="标签页菜单")
        expect(menu).to_be_visible()
        menu.locator("summary").filter(has_text="打开指定标签页").click()
        menu.get_by_role("button",name="Stage tab 4",exact=True).click()
        expect(page.get_by_role("button",name="Stage tab 4",exact=True)).to_have_class("stage-tab on")
        page.get_by_role("button",name="Stage tab 4",exact=True).click(button="right")
        menu.get_by_role("button",name="关闭其他标签页",exact=True).click()
        expect(page.locator(".stage-tab")).to_have_count(1)
        page.locator(".stage-tab").click(button="right")
        menu.locator("summary").filter(has_text="运行产物").click()
        menu.get_by_role("textbox",name="搜索运行产物").fill("UI Alpha T01 r2")
        expect(menu.locator('[role="treeitem"][aria-level="3"]')).to_have_count(1)
        page.screenshot(path=str(OUT/"tab-menu.png"))
        menu.get_by_role("button",name="打开",exact=True).click()
        expect(page.locator(".stage-tab")).to_have_count(2)
        expect(page.locator(".stage-grid iframe")).to_have_count(2)
        # Artifact picker: task-first tree, aligned rows, expand/collapse, keyboard and selection.
        page.get_by_role("button",name="打开产物",exact=True).first.click()
        picker=page.get_by_role("dialog",name="打开产物",exact=True)
        tree=picker.get_by_role("tree",name="运行产物",exact=True)
        expect(tree.locator('[role="treeitem"][aria-level="1"]')).to_have_count(9)
        expect(tree.get_by_role("treeitem")).to_have_count(9)
        picker.get_by_role("button",name="全部展开",exact=True).click()
        expect(tree.get_by_role("treeitem")).to_have_count(117)
        for row in tree.get_by_role("treeitem").all()[:15]:
            assert row.bounding_box()["height"]==34
            positions=row.locator('.explorer-chevron,.explorer-icon,.explorer-name').evaluate_all("els => els.map(e => {const r=e.getBoundingClientRect();return r.y+r.height/2})")
            assert max(positions)-min(positions)<2, positions
        picker.get_by_role("button",name="全部折叠",exact=True).click()
        expect(tree.get_by_role("treeitem")).to_have_count(9)
        first_task=tree.get_by_role("treeitem").first
        first_task.focus(); page.keyboard.press("ArrowRight")
        expect(tree.get_by_role("treeitem")).to_have_count(12)
        page.keyboard.press("ArrowRight"); page.keyboard.press("ArrowRight")
        expect(tree.locator('[role="treeitem"][aria-level="3"]')).to_have_count(3)
        page.keyboard.press("ArrowRight"); page.keyboard.press("Space")
        expect(picker.get_by_role("button",name="打开所选（1）",exact=True)).to_be_enabled()
        page.screenshot(path=str(OUT/"artifact-explorer.png"))
        # Repository files preserve ancestor folders and open contents in place.
        picker.get_by_role("tab",name="仓库文件",exact=True).click()
        files=picker.get_by_role("tree",name="仓库文件",exact=True)
        expect(files.get_by_role("treeitem",name="model",exact=True)).to_be_visible()
        picker.get_by_role("button",name="全部展开",exact=True).click()
        file=files.get_by_role("treeitem",name="notes.txt",exact=True)
        expect(file).to_be_visible()
        file.click()
        expect(picker.locator("pre.code")).to_contain_text("Content of model/Alpha/T01/r1/notes.txt")
        assert "workbench" not in file_reads, file_reads
        page.screenshot(path=str(OUT/"repository-explorer.png"))
        picker.get_by_role("button",name="全部折叠",exact=True).click()
        expect(files.get_by_role("treeitem",name="notes.txt",exact=True)).to_have_count(0)
        files.get_by_role("treeitem",name="README.md",exact=True).click()
        expect(picker.locator(".fprev-b")).to_contain_text("Content of README.md")
        picker.get_by_role("tab",name="运行产物",exact=True).click()
        expect(tree.locator('[role="treeitem"][aria-level="3"]')).to_have_count(3)
        expect(picker.get_by_role("button",name="打开所选（1）",exact=True)).to_be_enabled()
        picker.get_by_role("tab",name="仓库文件",exact=True).click()
        expect(picker.locator(".fprev-b")).to_contain_text("Content of README.md")
        picker.get_by_role("button",name="关闭 (Esc)",exact=True).click()
        # Long press moves only the header; clamp keeps the sheet inside the stage.
        sheet=page.get_by_role("complementary",name="评分面板")
        expect(sheet).to_be_visible()
        header=sheet.locator(".ss-h")
        box=header.bounding_box(); before=sheet.bounding_box()
        page.mouse.move(box["x"]+40,box["y"]+20); page.mouse.down(); page.wait_for_timeout(350)
        page.mouse.move(box["x"]-200,box["y"]+150,steps=10); page.mouse.up()
        after=sheet.bounding_box()
        assert after["x"] < before["x"]-150, (before,after)
        stage=page.locator(".stage").bounding_box()
        assert after["x"] >= stage["x"]-1 and after["y"] >= stage["y"]-1
        page.screenshot(path=str(OUT/"dragged.png"))
        page.reload()
        expect(sheet).to_be_visible()
        page.wait_for_timeout(450)
        restored=sheet.bounding_box()
        assert abs(restored["x"]-after["x"])<2, (restored,after)
        header.dblclick(position={"x":40,"y":20})
        assert sheet.bounding_box()["x"] > after["x"]+150
        page.get_by_role("button",name="收起",exact=True).click()
        expect(sheet).to_have_class("score-sheet glass-thick min")
        page.set_viewport_size({"width":850,"height":700})
        page.wait_for_timeout(150)
        small=sheet.bounding_box(); bounds=page.locator(".stage").bounding_box()
        assert small["x"] >= bounds["x"]-1 and small["x"]+small["width"] <= bounds["x"]+bounds["width"]+1
        assert not unexpected_writes,unexpected_writes
        assert not errors,errors
        print(json.dumps(dict(ok=True,task_rows=9,tiles=18,highest_score_and_tie=True,lazy_mount=True,interactive_iframes=True,expand=True,tab_tree=True,task_first_tree=True,expand_collapse_all=True,keyboard_tree_navigation=True,repository_file_preview=True,aligned_34px_rows=True,close_others=True,long_press=True,persist_position=True,reset_position=True,unexpected_writes=unexpected_writes,page_errors=errors),ensure_ascii=True))
        browser.close()
finally:
    server.shutdown(); server.server_close()
