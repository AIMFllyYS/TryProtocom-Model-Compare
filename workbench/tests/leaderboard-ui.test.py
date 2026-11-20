"""Headless leaderboard checks. The fixture server rejects all writes."""
import json
import os
import re
import struct
import xml.etree.ElementTree as ET
import threading
from zipfile import ZipFile
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import expect, sync_playwright


WORKBENCH = Path(__file__).resolve().parents[1]
DIST = Path(os.environ.get("WB_BOARD_TEST_DIST", WORKBENCH / "dist"))
OUT = WORKBENCH / ".runtime/leaderboard-ui"
OUT.mkdir(parents=True, exist_ok=True)

models = [
    dict(vendor="OpenAI", name="Atlas Old", created_at="2026-01-01"),
    dict(vendor="OpenAI", name="Atlas <New> XHigh", created_at="2026-05-01"),
    dict(vendor="Google", name="Gemini Example (HiGh)", created_at="2026-04-01"),
    dict(vendor="Google", name="Unranked Fixture", created_at="2026-03-01"),
]
dimensions = [dict(id=f"d{i}", name=name, kind="quality") for i, name in enumerate(
    ["3D", "动画动效", "前端 UI/UX", "后端", "工程化", "需求理解"])]
item = dict(id="H0", dim="d0", tier="basic", method="human", desc="构图与辨识度", status="scored")
task = dict(id="V01", name="Fixture", suite="v2", variants={}, items=[item], dims={"d0": 1})


def row(vendor, name, harness, rank, quality, n):
    return dict(vendor=vendor, model=name, entrant=f"{name} @ {harness}", harness=harness,
                rank=str(rank), quality=quality, dims=dict(zip((d["id"] for d in dimensions), [95, 80, 76, 66, 0, None])),
                ci_low=quality - 1, ci_high=quality + 1, runs=n, tasks=1, n_min=n, n_max=n,
                pass_rate=.8, complete=True, suite_exp_cost_usd=1, suite_exp_min=22, cost_coverage="1/1")


board = [
    row("Google", "Gemini Example (HiGh)", "cli", 1, 94, 1),
    row("OpenAI", "Atlas <New> XHigh", "cli", 2, 86, 2),
    row("OpenAI", "Atlas <New> XHigh", "desktop", 3, 76, 1),
    row("OpenAI", "Atlas Old", "cli", 4, 65, 1),
]
scores = [.9, .8, .6, .1]
runs = [dict(vendor=b["vendor"], model=b["model"], entrant=b["entrant"], tkey="V01", task="V01",
             run_id=f"fixture-{i}", graded=True, run_index=1, score=dict(total=b["quality"], items=[dict(item, s=scores[i])]))
        for i, b in enumerate(board)]
tasks = [dict(entrant=b["entrant"], task="V01", mean=b["quality"], sd=0, tiers={"basic": scores[i]})
         for i, b in enumerate(board)]
items = [dict(task="V01", item_id=item["id"], desc=item["desc"], method="human",
              mean=.6, between_sd=.3, within_sd=0, n=4, by_entrant={})]
uplift = [dict(entrant=b["entrant"], A_mean=60, C_mean=80, uplift=20) for b in board]
failures = [dict(entrant=b["entrant"], task="V01", run_id=r["run_id"], total=25, tags="Fixture failure <tag> & notes")
            for b, r in zip(board, runs)]
metric = dict(mean=1.5, rel=.9, tasks=1, tasks_total=1, suite_est=36, unc=.2, level="中")
base_aggregate = dict(board=board, entrants=[b["entrant"] for b in board], pending={}, tasks=tasks, items=items,
                      tkeys=["V01"], failures=failures, uplift=uplift, run_eff={r["run_id"]: {"minutes": 22} for r in runs},
                      eff_baseline=dict(time={"V01": 40},cost={"V01": 12}),
                      eff={
                          board[0]["entrant"]: dict(time=dict(metric, rel=.7, suite_est=28), cost={}),
                          board[1]["entrant"]: dict(time=dict(metric, mean=.9), cost=dict(metric, rel=1.3, suite_est=15.6)),
                          board[2]["entrant"]: dict(time=dict(metric, mean=2.1, rel=.55, suite_est=22), cost=dict(metric, rel=.5, suite_est=6)),
                      })
writes = []


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        url = urlsplit(self.path)
        if not url.path.startswith("/api/"):
            super().do_GET()
            return
        view = parse_qs(url.query).get("view", ["history"])[0]
        ag = dict(base_aggregate, view=view)
        if view == "full":
            ag.update(board=[], entrants=[], excluded=[dict(entrant=b["entrant"], missing=["V01（1/3）"]) for b in board])
        if url.path == "/api/events":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            self.wfile.write(b": fixture\n\n")
            return
        response = {
            "/api/session": dict(token="fixture", root=str(WORKBENCH.parent), version="test", desktop=False, paths={"store": "data/fixture.json"}),
            "/api/store": dict(models=models, runs=runs, workspaces=[], notes=[], settings={}),
            "/api/aggregate": ag,
            "/api/spec": dict(cfg=dict(name="Workbench UI", version="v1", pass_threshold=60), config_full={"v2": {"version": "v2"}},
                              dims=dimensions, tasks=[task], relations=[]),
        }.get(url.path, [])
        body = json.dumps(response).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        writes.append(self.path)
        self.send_error(403)


def save_png(page, picker, stem):
    with page.expect_download() as download:
        picker.get_by_role("button", name="下载 PNG").click()
    target = OUT / (stem + ".png")
    download.value.save_as(str(target))
    expect(picker).to_have_count(0)
    with target.open("rb") as image:
        h = image.read(24)
    assert h[:8] == b"\x89PNG\r\n\x1a\n", (stem, h)
    width, height = struct.unpack(">II", h[16:24])
    assert width >= 1400 and height >= 500, (stem, width, height)
    return target


server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(DIST)))
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1670, "height": 930})
        errors = []
        page.on("pageerror", lambda err: errors.append(str(err)))
        page.add_init_script("if (!localStorage.getItem('wb.view')) localStorage.setItem('wb.view', 'simple')")
        page.add_init_script("""(() => {
          const create = URL.createObjectURL;
          window.boardExportSvg = [];
          URL.createObjectURL = (blob) => {
            if (blob.type.startsWith('image/svg+xml')) window.boardExportSvg.push(blob.text());
            return create.call(URL, blob);
          };
        })()""")
        page.goto(f"http://127.0.0.1:{server.server_port}/#/board")
        rows = page.locator(".board-tbl tbody tr")
        dialog = page.get_by_role("dialog")
        menu = page.get_by_role("button", name="筛选模型")
        tabs = page.get_by_role("radiogroup", name="排行榜类型")
        expect(rows).to_have_count(4)
        assert len(set(rows.first.locator("td[data-board-score]").evaluate_all("(cells) => cells.map(c => getComputedStyle(c).backgroundColor)"))) == 6
        menu.click()
        expect(dialog).to_be_visible()
        expect(dialog).not_to_have_attribute("aria-modal", "true")
        assert dialog.evaluate("""el => {
          const r = el.getBoundingClientRect();
          const a = document.querySelector('.board-filter-trigger').getBoundingClientRect();
          return Math.abs(r.left - a.left) < 5 && r.top > a.bottom && r.top < a.bottom + 16 && r.height > innerHeight * .7;
        }""")
        expect(dialog.locator(".board-picker-vendor .avatar")).to_have_count(2)
        expect(dialog.locator(".board-picker-model .avatar")).to_have_count(2)
        expect(dialog.locator(".board-picker-model")).to_have_text(["Atlas <New> XHigh", "Atlas Old"])
        page.screenshot(path=str(OUT / "leaderboard-filter.png"), animations="disabled")
        dialog.get_by_role("button", name="清空", exact=True).click()
        dialog.get_by_text("Atlas <New> XHigh", exact=True).click()
        page.mouse.click(15, 15)
        expect(dialog).to_have_count(0)
        expect(rows).to_have_count(2)
        expect(rows.locator("td:nth-child(2)")).to_have_text(["2", "3"])
        expect(page.locator(".pod-rank")).to_have_text(["2", "3"])
        page.reload()
        expect(rows).to_have_count(2)

        tabs.get_by_role("radio", name="检查项分析").click()
        expect(page.locator(".board-panels tbody tr td:nth-child(5)")).to_have_text("70")
        expect(page.locator(".board-panels tbody tr td:nth-child(8)")).to_have_text("2")
        previous_tab = "统计图" if tabs.get_by_role("radio", name="统计图").count() else "逐题"
        tabs.get_by_role("radio", name=previous_tab).click()
        if previous_tab == "统计图":
            win = page.locator('[data-chart="两两胜率矩阵"]')
            expect(win.locator("text").get_by_text(re.compile(r"^2\. Atlas <New>"))).to_have_count(1)

        tabs.get_by_role("radio", name="总榜").click(button="right")
        expect(dialog.get_by_text("总榜 · 3× PNG")).to_be_visible()
        dialog.get_by_role("searchbox").fill("Gemini Example (HiGh)")
        dialog.get_by_text("Gemini Example (HiGh)", exact=True).click()
        save_png(page, dialog, "total")
        exported = page.evaluate("() => window.boardExportSvg.at(-1)")
        assert "Gemini Example" in exported and "Atlas &lt;New&gt;" in exported and "Atlas Old" not in exported
        assert "(xhigh)" in exported and "(high)" in exported and "XHigh" not in exported
        assert "@ cli" in exported and "@ desktop" in exported
        root = ET.fromstring(exported)
        ns = {"s": "http://www.w3.org/2000/svg"}
        labels = root.findall(".//s:g[@data-model-label='true']", ns)
        assert len(labels) == 3 and all(x.find("s:image", ns).get("href").startswith("data:image/svg+xml,") for x in labels)
        for label in ["94.0", "93.0–95.0", "80%", "$1.00", "22 分", "名次", "95% CI"]:
            cells = [t for t in root.findall(".//s:text", ns) if t.findtext("s:tspan", namespaces=ns) == label]
            assert cells and all(t.get("text-anchor") == "middle" for t in cells), label
        table_text = {tuple(s.text for s in t.findall("s:tspan", ns)) for t in root.findall(".//s:text", ns)}
        assert all((name,) in table_text for name in ["质量分", "95% CI", "期望成本", "期望用时"] + [d["name"] for d in dimensions])
        expect(tabs.get_by_role("radio", name=previous_tab)).to_be_checked()
        tabs.get_by_role("radio", name="总榜").click()
        expect(rows).to_have_count(2)
        rows.first.click(button="right")
        expect(dialog.get_by_text("总榜 · 3× PNG")).to_be_visible()
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)

        titles = ["维度", "逐题", "效率", "检查项分析", "Skill 增益", "失败归因"]
        if previous_tab == "统计图":
            titles.append("统计图")
        for title in titles:
            tabs.get_by_role("radio", name=title, exact=True).click(button="right")
            save_png(page, dialog, title)
        tabs.get_by_role("radio", name="效率", exact=True).click()
        effort_table = page.locator(".card").filter(has_text="速度与价格权衡").locator("table")
        effort_table.locator("th").get_by_text("速度", exact=True).click(button="right")
        expect(dialog.get_by_text("速度榜 + 价格榜 · 2 张高清 PNG")).to_be_visible()
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        page.get_by_role("button", name="导出速度榜和价格榜", exact=True).click()
        dialog.get_by_role("button", name="全选", exact=True).click()
        page.evaluate("window.boardExportSvg.length = 0")
        with page.expect_download() as archive_download:
            dialog.get_by_role("button", name="下载 ZIP").click()
        expect(dialog).to_have_count(0)
        with ZipFile(archive_download.value.path()) as archive:
            assert archive.namelist() == ["速度榜.png", "价格榜.png"]
            for image in archive.namelist():
                png = archive.read(image)
                assert png[:8] == b"\x89PNG\r\n\x1a\n"
                assert struct.unpack(">II", png[16:24])[0] > 3000
        speed, price = page.evaluate("() => Promise.all(window.boardExportSvg)")
        assert "#e8f0f9" in speed and "#f6eee4" in price
        for image in [speed, price]:
            assert "换算汇率 1 USD = ¥6.8" in image
            tree = ET.fromstring(image)
            text = {tuple(s.text for s in t.findall("s:tspan", ns)) for t in tree.findall(".//s:text", ns)}
            assert all((t,) in text for t in ["质量分", "整套预计用时（分钟）", "整套估算费用（元）", "¥40.80", "¥106.08"])
            assert len(tree.findall(".//s:g[@data-model-label='true']", ns)) == 4
            numeric = {"排名", "质量分", "整套预计用时（分钟）", "整套估算费用（元）", "¥40.80", "¥106.08", "1 / 1 题", "±20% · 中"}
            cells = [t for t in tree.findall(".//s:text", ns) if t.findtext("s:tspan", namespaces=ns) in numeric]
            assert {t.findtext("s:tspan", namespaces=ns) for t in cells} == numeric and all(t.get("text-anchor") == "middle" for t in cells)
        assert "按每题平均用时升序" in speed and "每题平均用时（分钟）" in speed and ">-18<" in speed and "相对价格" not in speed
        assert "相对价格" in price and "0.50×" in price and "整套较基线（分钟）" not in price
        assert speed.index("@ cli") < speed.index("Gemini Example") < speed.index("@ desktop") < speed.index("暂无可比用时") < speed.index("Atlas Old")
        assert price.index("@ desktop") < price.index("@ cli") < price.index("暂无可比费用") < price.index("Gemini Example") < price.index("Atlas Old")
        tabs.get_by_role("radio", name="维度").click()
        page.locator('[data-chart="参赛者 × 维度"]').click(button="right")
        expect(dialog.get_by_text("参赛者 × 维度 · 3× PNG")).to_be_visible()
        save_png(page, dialog, "dimension-card")
        exported = page.evaluate("() => window.boardExportSvg.at(-1)")
        assert 'data-model-label="true"' in exported and '(xhigh)' in exported and '@ cli' in exported

        page.get_by_role("radio", name="v2 完整版").click()
        expect(page.locator(".board-panels tbody tr")).to_have_count(0)
        expect(page.get_by_text("未入榜（没测满）")).to_be_visible()
        expect(page.locator(".tbl tbody tr")).to_have_count(2)
        page.get_by_role("radio", name="v2 简化版").click()
        tabs.get_by_role("radio", name="总榜").click()
        page.get_by_role("checkbox", name="只看 n=1（没有重测）").click()
        expect(rows).to_have_count(1)
        expect(rows.first.locator("td").nth(1)).to_have_text("3")
        page.get_by_role("checkbox", name="只看 n=1（没有重测）").click()

        base_aggregate["failures"] = [dict(failures[1], run_id=f"large-{i:03}") for i in range(110)]
        page.reload()
        tabs.get_by_role("radio", name="失败归因").click(button="right")
        with page.expect_download() as download:
            dialog.get_by_role("button", name="下载 PNG").click()
        assert download.value.suggested_filename.endswith(".zip")
        with ZipFile(download.value.path()) as archive:
            assert len(archive.namelist()) > 1
            assert all(archive.read(name).startswith(b"\x89PNG") for name in archive.namelist())
        expect(dialog).to_have_count(0)
        base_aggregate["uplift"] = []
        page.reload()
        tabs.get_by_role("radio", name="Skill 增益", exact=True).click(button="right")
        dialog.get_by_role("button", name="下载 PNG").click()
        expect(dialog.get_by_role("alert")).to_have_text("所选模型在这张榜单中没有可导出数据")
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)

        page.get_by_role("button", name="盲评模式：点击隐藏模型名").click()
        page.get_by_role("button", name="切换到深色").click()
        page.emulate_media(reduced_motion="reduce")
        page.set_viewport_size({"width": 390, "height": 650})
        menu.click()
        expect(dialog).to_have_css("animation-name", "none")
        expect(dialog.get_by_text("OpenAI", exact=True)).to_have_count(0)
        expect(dialog.get_by_text("Atlas <New> XHigh", exact=True)).to_have_count(0)
        expect(dialog.get_by_role("checkbox", name="模型 C", exact=True)).to_be_checked()
        assert dialog.bounding_box()["width"] <= 390
        page.screenshot(path=str(OUT / "leaderboard-filter-dark.png"))
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        expect(menu).to_be_focused()
        assert not errors, errors
        assert not writes, writes
        page.set_viewport_size({"width": 1440, "height": 900})
        page.get_by_role("button", name="盲评模式：已隐藏模型名（点击显示）").click()
        page.goto(f"http://127.0.0.1:{server.server_port}/#/exports")
        chart = page.locator(".card").filter(has_text="参赛者 × 维度").filter(has=page.locator('[data-chart="参赛者 × 维度"]'))
        chart.get_by_role("button", name="导出图表").click()
        with page.expect_download() as event:
            page.get_by_text("SVG（矢量）", exact=True).click()
        vector = Path(event.value.path()).read_text(encoding="utf8")
        assert "data:image/svg+xml," in vector and "(xhigh)" in vector and "@ cli" in vector
        assert not errors, errors
        assert not writes, writes
        print(f"Leaderboard UI passed, including anchored model selection and {len(titles) + 1} scoped PNG exports.")
        browser.close()
finally:
    server.shutdown()
    server.server_close()
