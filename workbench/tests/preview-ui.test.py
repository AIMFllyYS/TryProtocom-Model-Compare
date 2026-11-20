"""Headless UI regression against an isolated fixture API; never writes benchmark data.
Run after npm run build: python tests/preview-ui.test.py
"""
import copy
import json
import os
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote, urlencode
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
DIST = Path(os.environ.get("WB_PREVIEW_TEST_DIST", ROOT / "workbench/dist")).resolve()
OUT = ROOT / "workbench/.runtime/preview-ui"
OUT.mkdir(parents=True, exist_ok=True)
keys = ["T01", "T02", "T03A", "T03C", "T04", "T05", "T06", "T07", "T08"]
item = dict(id="H1", dim="ui", tier="basic", tier_label="基础", method="human", method_label="人工", weight=1, desc="测试交互与视觉表现", metric="", rule="", anchors=["0 分", "1 分", "2 分", "3 分"], levels=[f"{n} 分的分辨" for n in range(1, 11)], evidence="查看产物", variants=[])
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
processes = []
preview_requests = []
unexpected_writes = []
manual_writes = []
file_reads = []
allow_manual = False
slow_save_started = threading.Event()
release_save = threading.Event()
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
        values={"/api/session":dict(token="fixture",desktop=False,root=str(ROOT),version="test"), "/api/spec":spec, "/api/store":store, "/api/aggregate":aggregate, "/api/preview":sessions, "/api/jobs":[], "/api/procs":processes, "/api/harness":[]}
        if path=="/api/events":
            self.send_response(200); self.send_header("Content-Type","text/event-stream"); self.end_headers()
            for item in sessions: self.wfile.write(("data: "+json.dumps(dict(type="session",id=item["id"],session=item))+"\n\n").encode())
            return
        if path in values: self.send_json(values[path]); return
        if path.startswith("/api/preview/"):
            entry=next((s for s in sessions if s["id"] == path.rsplit("/",1)[-1]), None)
            if entry: self.send_json(entry); return
        if path.startswith("/api/"): self.send_json([]); return
        super().do_GET()
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers.get("Content-Length","0"))) or "{}")
        if self.path=="/api/preview":
            preview_requests.append(body)
            entry=session("fixture-"+str(len(sessions)),body.get("label","Artifact"),base)
            if body.get("ref"):
                entry.update(kind="static", root=str(ROOT / "model" / body["ref"]), entry=body.get("entry", ""))
            sessions.append(entry); self.send_json(entry); return
        if allow_manual and self.path.startswith("/api/runs/") and self.path.endswith("/manual"):
            run_id=unquote(self.path.split("/")[3])
            run=next(r for r in runs if r["run_id"] == run_id)
            result=next(i for i in run["score"]["items"] if i["id"] == body["item"] and i["method"] == "human")
            value=body["score"]
            manual_writes.append((run_id, result["id"], value))
            if value == 9:
                slow_save_started.set()
                if not release_save.wait(8): self.send_json({"error":"Test action timed out"},500); return
            if value == 4: self.send_json({"error":"Fixture save failed"},500); return
            if value == "":
                run["manual"].pop(result["id"], None)
                result.update(status="pending",s=None)
            else:
                run["manual"][result["id"]]=dict(score=value,note=body["note"],scale=body["scale"])
                result.update(status="scored",s=value/10)
            score=run["score"]
            counted=[i for i in score["items"] if i["status"] in ("scored","missing")]
            score["total"]=round(100*sum(i["weight"]*i["s"] for i in counted)/sum(i["weight"] for i in counted),2)
            score["pending"]=[i["id"] for i in score["items"] if i["status"]=="pending"]
            score["complete"]=not score["pending"]
            self.send_json(dict(score=score,manual=run["manual"])); return
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
            h = row.bounding_box()["height"]
            assert h == 34, h
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
        # 评分题在左侧栏，不盖住舞台。
        sheet=page.get_by_role("complementary",name="评分面板")
        expect(sheet).to_be_visible()
        expect(sheet.get_by_role("radio")).to_have_count(10)
        side=page.locator("nav.side").bounding_box()
        box=sheet.bounding_box(); stage=page.locator(".stage").bounding_box()
        assert box["x"] >= side["x"]-1 and box["x"]+box["width"] <= side["x"]+side["width"]+2
        assert box["x"]+box["width"] <= stage["x"]+2
        page.screenshot(path=str(OUT/"score-dock.png"))
        page.get_by_role("button",name="切回左侧导航",exact=True).click()
        expect(sheet).to_have_count(0)
        expect(page.get_by_role("link",name="总览",exact=True)).to_be_visible()
        page.get_by_role("button",name="显示当前评分题",exact=True).click()
        expect(sheet).to_be_visible()
        expect(sheet.get_by_role("button", name="添加备注", exact=True)).to_be_visible()
        expect(sheet.get_by_role("button", name="关闭评分面板")).to_have_count(0)
        expect(sheet.get_by_role("group", name="作答方式")).to_be_visible()
        page.set_viewport_size({"width":850,"height":700})
        page.wait_for_timeout(150)
        small=sheet.bounding_box(); bounds=page.locator(".stage").bounding_box()
        assert small["x"]+small["width"] <= bounds["x"]+2
        assert not unexpected_writes,unexpected_writes

        page.set_viewport_size({"width":1440,"height":920})
        first_run, second_run, proxy_run = runs[:3]
        second_item={**item,"id":"H2","desc":"第二个人工项"}
        spec["tasks"][0]["items"].append(second_item)
        first_run["score"]["items"].extend([
            {**second_item,"status":"pending","s":None},
            {**item,"id":"A1","method":"auto","weight":2,"status":"scored","s":.75},
            {**item,"id":"A2","method":"auto","weight":1,"status":"missing","s":0},
            {**item,"id":"A3","method":"auto","weight":6,"status":"na","s":None},
            {**item,"id":"G1","method":"agent","weight":1,"status":"scored","s":.5},
            {**item,"id":"G2","method":"agent","weight":4,"status":"pending","s":None},
        ])
        first_run["score"].update(complete=False,pending=["H1","H2","G2"])
        second_run["score"].update(total=40,complete=False,capped=True,cap_value=40)
        proxy_run["score"].update(total=0,complete=False,gate_pass=False)
        proxy_run["score"]["items"].append({**item,"id":"A0","method":"auto","weight":1,"status":"scored","s":0})
        video_run=next(r for r in runs if r["tkey"]=="T04")
        video_ws=next(w for w in workspaces if w["ref"]==video_run["ws_ref"])
        video_ws["entry"]="sample.mp4"
        workspaces.append({**workspaces[0], "ref":"Test/UI Alpha/T01/r10", "index":10, "grader_run_id":None})
        runs[-2]["dir"]=runs[-1]["dir"]="bench-data/runs/shared"
        sessions.extend([
            {**session("old-static","Recovered artifact",base), "kind":"static", "root":str(ROOT / "model" / first_run["ws_ref"]), "entry":"index.html"},
            {**session("dev-proxy","Dev preview",base), "kind":"proxy", "proc_id":"dev"},
            {**session("unregistered-static","Unregistered artifact",base), "kind":"static", "root":str(ROOT / "model" / "Test/UI Alpha/T01/r10"), "entry":"index.html"},
            {**session("ambiguous-static","Ambiguous artifact",base), "kind":"static", "root":str(ROOT / "bench-data/runs/shared"), "entry":"index.html"},
            {**session("plain-static","Ordinary file",base), "kind":"static", "root":str(ROOT / "docs"), "entry":"index.html"},
        ])
        processes.append(dict(id="dev",name="Fixture",cwd=str(ROOT / "model" / proxy_run["ws_ref"] / "app"),cmd="fixture",status="exited",started_at=1,session_id="dev-proxy"))
        page.evaluate("""() => {
            localStorage.setItem('wb.stage.panes', '[]'); localStorage.removeItem('wb.stage.score');
            localStorage.removeItem('wb.stage.sideScore'); localStorage.setItem('wb.stage.layout', '\"cols\"');
        }""")
        page.reload()
        folder=page.get_by_role("button",name="运行产物",exact=True)
        nav_link=page.get_by_role("link",name="总览",exact=True)
        dock=page.locator("#stage-artifact-panel")
        search=dock.get_by_role("textbox",name="搜索运行产物")
        tree=dock.get_by_role("tree",name="运行产物")
        separator=page.get_by_role("separator",name="调整左侧栏宽度")
        summary=sheet.get_by_role("group",name="评分摘要")
        scores=summary.locator(".ss-summary-number")
        expect(page.locator(".stage-empty")).to_be_visible()
        folder.click(); expect(tree).to_be_visible(); expect(nav_link).to_be_hidden()
        folder.click(); expect(nav_link).to_be_visible()
        folder.click(); search.fill("UI Alpha T01 r2")
        tree.locator('[role="treeitem"][aria-level="3"]').click()
        r2_pane=page.locator(".stage-grid .pane").first
        r2_score=r2_pane.get_by_role("button",name="人工评分",exact=True)
        expect(r2_score).to_be_visible()
        tree.locator('[role="treeitem"][aria-level="3"]').press("Enter")
        expect(page.locator(".stage-tab")).to_have_count(1)
        expect(tree).to_be_visible()
        page.screenshot(path=str(OUT/"stage-artifact-sidebar.png"))
        r2_pane.locator("iframe").content_frame.get_by_role("button",name="Test interaction").click()
        r2_score.click(); expect(sheet.locator(".ss-ht")).to_contain_text("r2")
        expect(summary).to_contain_text("封顶 40")
        expect(scores).to_have_text(["40.0","—"])
        expect(tree).to_be_hidden()
        # A repeated direct action on the same run must reopen scoring.
        page.get_by_role("button",name="切回左侧导航").click(); expect(sheet).to_be_hidden()
        page.keyboard.press("1")
        assert not manual_writes
        r2_score.click(); expect(sheet).to_be_visible()
        expect(r2_pane.locator("iframe").content_frame.get_by_role("button",name="Clicked")).to_be_visible()
        for _ in range(2):
            page.evaluate("hash => { location.hash = hash; }", "/stage?"+urlencode({"score":second_run["run_id"]}))
            expect(sheet).to_be_visible()
            page.wait_for_function("location.hash === '#/stage'")
            page.get_by_role("button",name="切回左侧导航").click()
        page.get_by_role("button",name="打开评分面板").click()
        page.get_by_role("option",name="T01 · UI Alpha · r2",exact=False).click()
        expect(sheet.locator(".ss-ht")).to_contain_text("r2")
        page.get_by_role("button",name="切回左侧导航").click()
        page.get_by_role("button",name="显示当前评分题").click()
        folder.click(); expect(search).to_have_value("UI Alpha T01 r2")
        folder.click(); expect(sheet.locator(".ss-ht")).to_contain_text("r2")

        # Restored static, proxy, and plain external sessions are resolved by their source.
        for sid in ("old-static","dev-proxy","stage-0","unregistered-static","ambiguous-static","plain-static"):
            page.evaluate("id => { location.hash = '/stage?session=' + id; }", sid)
            page.wait_for_function("location.hash === '#/stage'")
        page.get_by_role("button",name="Recovered artifact",exact=True).click()
        expect(sheet.locator(".ss-ht")).to_contain_text("r2")
        focused=page.locator(".stage-grid .pane.focused")
        focused.get_by_role("button",name="人工评分",exact=True).click()
        expect(sheet.locator(".ss-ht")).to_contain_text("r1")
        expect(scores).to_have_text(["50.0","50.0"])
        expect(summary).to_contain_text("1 项待评")
        expect(sheet.get_by_role("button",name="复制 Agent 评分提示词")).to_be_visible()
        assert summary.bounding_box()["height"] <= 62
        sheet.get_by_role("button",name="H2 · 待评").click()
        expect(sheet.locator(".ss-desc")).to_contain_text("第二个人工项")
        folder.click(); expect(search).to_have_value("UI Alpha T01 r2")
        page.keyboard.press("2")
        folder.click(); expect(sheet.locator(".ss-desc")).to_contain_text("第二个人工项")
        expect(page.locator(".side")).to_have_css("width","372px")
        separator.focus(); separator.press("ArrowRight")
        expect(page.locator(".side")).to_have_css("width","388px")
        rect=separator.bounding_box()
        x,y=rect["x"]+rect["width"]/2,rect["y"]+rect["height"]/2
        page.mouse.move(x,y); page.mouse.down(); page.mouse.move(x+90,y+220,steps=5); page.mouse.up()
        expect(page.locator(".side")).to_have_css("width","478px")
        expect(r2_pane.locator("iframe").content_frame.get_by_role("button",name="Clicked")).to_be_visible()
        assert page.evaluate("JSON.parse(localStorage.getItem('wb.stage.sidebarWidth'))")==478

        allow_manual=True
        sheet.get_by_role("radio").nth(7).click(); expect(scores).to_have_text(["56.0","50.0"])
        sheet.get_by_role("radio").nth(3).click()
        expect(page.get_by_text("H2 保存失败",exact=False)).to_be_visible()
        expect(sheet.get_by_role("radio").nth(7)).to_have_attribute("aria-checked","true")
        expect(scores).to_have_text(["56.0","50.0"])
        page.keyboard.press("Backspace"); expect(scores).to_have_text(["50.0","50.0"])
        sheet.get_by_role("radio").nth(8).click()
        assert slow_save_started.wait(3)
        expect(sheet.get_by_text("保存中")).to_be_visible()
        page.get_by_role("button",name="Dev preview",exact=True).click()
        focused.get_by_role("button",name="人工评分",exact=True).click()
        expect(sheet.locator(".ss-ht")).to_contain_text("r3")
        expect(summary).to_contain_text("门槛未通过")
        release_save.set(); expect(scores).to_have_text(["0.0","0.0"])
        page.get_by_role("button",name="Recovered artifact",exact=True).click()
        focused.get_by_role("button",name="人工评分",exact=True).click()
        expect(scores).to_have_text(["58.0","50.0"])
        assert manual_writes==[(first_run["run_id"],"H2",score) for score in (8,4,"",9)],manual_writes
        if page.locator(".toast.error").count():
            page.locator(".toast.error").get_by_role("button",name="关闭").click()
        page.screenshot(path=str(OUT/"stage-score-sidebar.png"))
        for title in ("Stage tab 0", "Ambiguous artifact", "Ordinary file"):
            page.get_by_role("button",name=title,exact=True).click()
            expect(focused.get_by_role("button",name="人工评分",exact=False)).to_have_count(0)
        page.get_by_role("button",name="Unregistered artifact",exact=True).click()
        expect(focused.get_by_role("button",name="人工评分：运行尚无评分结果，暂不可人工评分")).to_have_attribute("aria-disabled","true")

        # Play a synthetic stream to exercise the actual video element without touching production fixtures.
        page.evaluate("ref => { location.hash = '/stage?' + new URLSearchParams({open: 'ws:' + ref}); }",video_ws["ref"])
        video=focused.locator("video")
        expect(video).to_be_visible()
        video.evaluate("""video => {
            const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 60;
            const context = canvas.getContext('2d'); window.videoFixtureFrames = 0;
            window.videoFixtureTimer = setInterval(() => {
                context.fillStyle = window.videoFixtureFrames++ % 2 ? 'navy' : 'teal'; context.fillRect(0,0,80,60);
            }, 45);
            video.srcObject = canvas.captureStream(20); video.muted = true;
        }""")
        focused.get_by_role("button",name="播放 (空格)").click()
        page.wait_for_function("document.querySelector('.pane.focused video')?.currentTime > 0.15")
        playing=video.element_handle()
        t=video.evaluate("video => video.currentTime")
        focused.get_by_role("button",name="人工评分",exact=True).click()
        expect(sheet.locator(".ss-ht")).to_contain_text("T04")
        expect(summary).to_contain_text("未评完")
        folder.click(); folder.click()
        assert video.evaluate("(video, previous) => video === previous && !video.paused",playing)
        page.wait_for_function("t => document.querySelector('.pane.focused video')?.currentTime > t", arg=t)
        page.evaluate("clearInterval(window.videoFixtureTimer)")

        # Reduced motion, drawer close, blind labels, persisted width and no page overflow.
        page.emulate_media(reduced_motion="reduce")
        expect(page.locator(".stage-shell")).to_have_css("transition-property","none")
        expect(page.locator("#stage-score-panel")).to_have_css("animation-name","none")
        page.set_viewport_size({"width":390,"height":620})
        expect(sheet).to_be_visible()
        expect(separator).to_be_hidden()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        expect(summary).to_be_visible()
        assert summary.bounding_box()["height"] <= 68
        page.screenshot(path=str(OUT/"score-drawer.png"))
        sheet.locator("xpath=ancestor::nav").get_by_role("button",name="切换到深色").click()
        expect(page.locator("html")).to_have_attribute("data-theme","dark")
        expect(scores).to_have_text(["50.0","—"])
        page.screenshot(path=str(OUT/"score-drawer-dark.png"))
        sheet.locator("xpath=ancestor::nav").get_by_role("button",name="切换到浅色").click()
        page.get_by_role("button",name="切回左侧导航").click(); expect(sheet).to_be_hidden()
        page.set_viewport_size({"width":1440,"height":920})
        page.get_by_role("button",name="盲评模式：点击隐藏模型名").click()
        folder.click(); search.fill("T01")
        expect(tree.get_by_role("treeitem",name="模型 A",exact=True)).to_be_visible()
        expect(tree.get_by_role("treeitem",name="UI Alpha",exact=True)).to_have_count(0)
        page.reload(); folder.click()
        expect(page.locator(".side")).to_have_css("width","478px")
        assert not unexpected_writes,unexpected_writes
        assert not errors,errors
        print(json.dumps(dict(ok=True,task_rows=9,tiles=18,highest_score_and_tie=True,lazy_mount=True,interactive_iframes=True,tab_tree=True,repository_file_preview=True,score_dock=True,ten_levels=True,stage_tree=True,resize=True,run_bound_scoring=True,video_playback=True,race_safe_saves=True,narrow_drawer=True,unexpected_writes=unexpected_writes,page_errors=errors),ensure_ascii=True))
        browser.close()
finally:
    server.shutdown(); server.server_close()
