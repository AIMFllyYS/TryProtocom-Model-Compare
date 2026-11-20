"""Exercise the real Workbench UI against a disposable local store."""
import json
from pathlib import Path
import socket
import subprocess
import tempfile

from playwright.sync_api import expect, sync_playwright


WORKBENCH = Path(__file__).resolve().parents[1]
SERVER = """
const {startServer} = require('./dist-node/server.cjs');
const path = require('node:path');
const [root, port] = process.argv.slice(1);
startServer({
  root, port: Number(port), python: null, runtimeDir: root,
  webDist: path.resolve('dist'), storeFile: path.join(root, 'store.json'),
  modelDir: path.join(root, 'model'), benchData: path.join(root, 'bench-data'),
}).then((server) => {
  console.log(server.url);
  process.stdin.resume();
  process.stdin.on('end', () => void server.close());
});
"""


with tempfile.TemporaryDirectory(prefix="wb-model-ui-") as scratch:
    root = Path(scratch)
    (root / ".agents/skills").mkdir(parents=True)
    target = root / "model/Tencent/Hy4%20Flash"
    target.mkdir(parents=True)
    (target / "fixture.txt").write_text("disposable", encoding="utf-8")
    cfg = dict(name="Fixture", version="v2.0", runs_per_task=1, pass_threshold=60,
               efficiency=dict(cost=dict(best=0, worst=1), speed=dict(best=0, worst=1)))
    spec = dict(tasks=[], dims=[], relations=[], cfg=cfg, config_full=cfg)
    profile = dict(schema=1, vendor="Tencent", name="Hy4%20Flash", created_at="2026-01-01T00:00:00Z")
    store_file = root / "store.json"
    store_file.write_text(json.dumps(dict(
        schema="bench-store/1", models=[profile], runs=[], workspaces=[], notes=[], history=[], spec=spec,
        settings=dict(current_model="Tencent/Hy4%20Flash"),
    )), encoding="utf-8")
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    server = subprocess.Popen(
        ["node", "-e", SERVER, scratch, str(port)], cwd=WORKBENCH, text=True,
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    try:
        base = server.stdout.readline().strip()
        assert base == f"http://127.0.0.1:{port}", base
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(viewport=dict(width=1280, height=900))
            page.goto(base + "/#/models/Tencent/Hy4%2520Flash")
            opener = page.get_by_role("button", name="永久删除模型", exact=True)
            opener.click()
            confirm = page.get_by_role("textbox", name="完整模型键")
            proceed = page.get_by_role("button", name="永久删除", exact=True)
            confirm.fill("Tencent/Hy4 Flash")
            expect(proceed).to_be_disabled()
            page.get_by_role("button", name="取消", exact=True).click()
            assert (target / "fixture.txt").exists()
            assert not json.loads(store_file.read_text(encoding="utf-8")).get("model_deletions")
            opener.click()
            confirm.fill("Tencent/Hy4%20Flash")
            with page.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/api/models/delete")) as deleted:
                proceed.click()
            assert deleted.value.ok, deleted.value.text()
            expect(page).to_have_url(base + "/#/models")
            assert not target.exists()
            page.get_by_role("button", name="新增模型", exact=True).click()
            field = page.get_by_role("textbox", name="模型名称", exact=True)
            with page.expect_response(lambda r: "/api/models/infer?name=GPT" in r.url):
                field.fill("GPT")
            field.fill("GPT 5.6 Full Name Fixture")
            with page.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/api/models")) as added:
                field.press("Enter")
            assert added.value.ok, added.value.text()
            assert added.value.json()["name"] == "GPT 5.6 Full Name Fixture"
            browser.close()
        print("Model UI passed: cancellation, exact confirmation, disk deletion, fast entry")
    finally:
        server.stdin.close()
        try:
            server.wait(timeout=8)
        except subprocess.TimeoutExpired:
            server.terminate()
            server.wait(timeout=8)
