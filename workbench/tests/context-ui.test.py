"""在随机端口的内存 API 上验证上下文 UI；无正式数据或可见窗口。先运行 build。"""
import json
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'workbench/.runtime/context-ui'
OUT.mkdir(parents=True, exist_ok=True)
ref = 'Fixture/中文 Model/B1/r1'
ws = dict(schema=1, ref=ref, vendor='Fixture', model='中文 Model', task='B1', variant=None, tkey='B1', index=1,
          harness='test', created_at='2026-01-01', started_at=None, ended_at=None, grader_run_id=None,
          deliverable_dir='output', workspace='D:/fixture/' + ref, detect=dict(checks=[], done=0, total=1, final=False))
model = dict(schema=1, vendor='Fixture', name='中文 Model', harness='test', created_at='2026-01-01')
task = dict(id='B1', name='测试题', short='测试', variants={}, dims={}, items=[], gates=[], hidden=[], materials=[], deliverable='output', prompt='原题', condition='', suite='v2')
store = dict(schema='bench-store/1', settings=dict(current_model='Fixture/中文 Model'), models=[model], workspaces=[], runs=[], notes=[], history=[], trash=[])
spec = dict(cfg=dict(name='Fixture', version='test', runs_per_task=1), tasks=[task], dims=[], relations=[])
report = dict(schema='context-audit/1', ref=ref, run_id=None, policy_version='legacy', pending_count=1, stale=False,
              coverage=dict(tools='partial', initial_context='unknown'), prompt_provenance=dict(archive='warning', sent='unknown'), sources=[],
              findings=[dict(id='fixture', evidence_id='e', finding_kind='memory', observation='attempt', review_state='pending', source='fixture.jsonl', line=2, summary='虚构读取尝试')])
claims = []
unexpected = []


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send_json(self, value):
        data = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = urlsplit(self.path).path
        query = parse_qs(urlsplit(self.path).query)
        if path == '/api/events':
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.end_headers()
            return
        routes = {'/api/session': dict(token='fixture', desktop=False, root=str(ROOT), version='test'), '/api/spec': spec,
                  '/api/store': store, '/api/aggregate': dict(board=[], tasks=[], pending={}, entrants=[], tkeys=[]), '/api/preview': [], '/api/procs': [], '/api/jobs': [], '/api/harness': [],
                  '/api/context': report if query else [report], '/api/ws/final': dict(text='', prompt='最终权威提示词'),
                  '/api/ws/prompt': dict(text='预览提示词', warnings=['旧版约束，未增强'], ref=ref, workspace=ws['workspace'], index=1, exists=True)}
        if path in routes:
            self.send_json(routes[path])
            return
        if path.startswith('/api/'):
            self.send_json([])
            return
        super().do_GET()

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', '0'))) or '{}')
        if self.path == '/api/ws/claim':
            claims.append(body)
            ws['started_at'] = '2026-01-01T01:00:00Z'
            store['workspaces'] = [ws]
            self.send_json(dict(run=ws, text='最终权威提示词', opened=None, warnings=['旧版约束，未增强']))
        elif self.path == '/api/settings':
            store['settings'].update(body)
            self.send_json(store['settings'])
        else:
            unexpected.append(self.path)
            self.send_json({})


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(ROOT / 'workbench/dist')))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{server.server_port}'
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.add_init_script("""window.copyCalls = []; window.allowCopy = false;
          Object.defineProperty(navigator, 'clipboard', {value: {writeText: async text => {
            window.copyCalls.push(text); if (window.copyCalls.length > 1 && !window.allowCopy) throw Error('denied');
          }}}); document.execCommand = () => false;""")
        page.goto(base + '/#/tasks/B1')
        page.get_by_role('button', name='复制提示词', exact=False).first.click()
        expect(page.get_by_text('最终提示词复制失败', exact=False)).to_be_visible()
        expect(page.get_by_role('textbox', name='最终权威提示词')).to_have_value('最终权威提示词')
        assert len(claims) == 1
        page.keyboard.press('c')
        assert len(claims) == 1
        page.evaluate('window.allowCopy = true')
        page.get_by_role('button', name='重试复制最终提示词').click()
        expect(page.get_by_text('已复制，粘贴给', exact=False)).to_be_visible()
        assert len(claims) == 1
        page.screenshot(path=str(OUT / 'handoff.png'))
        page.goto(base + '/#/runs/' + ref)
        expect(page.get_by_text('上下文审计', exact=True)).to_be_visible()
        expect(page.get_by_text('发送文本未核验', exact=False)).to_be_visible()
        page.locator('summary').filter(has_text='证据与复核').click()
        expect(page.get_by_text('虚构读取尝试', exact=False)).to_be_visible()
        page.screenshot(path=str(OUT / 'audit.png'))
        page.goto(base + '/#/runs')
        expect(page.get_by_role('button', name='全部约束版本', exact=False)).to_be_visible()
        expect(page.get_by_role('button', name='全部审计状态', exact=False)).to_be_visible()
        # 发车台复用同一失败恢复链，不再请求 claim。
        page.goto(base + '/#/tasks/B1')
        page.get_by_role('button', name='发车台', exact=True).click()
        page.evaluate('window.allowCopy = false; window.copyCalls = []')
        page.get_by_role('button', name='仅复制', exact=False).click()
        expect(page.get_by_text('最终提示词复制失败', exact=False)).to_be_visible()
        expect(page.get_by_role('textbox', name='最终权威提示词')).to_have_value('最终权威提示词')
        assert len(claims) == 2
        page.evaluate('window.allowCopy = true')
        page.get_by_role('button', name='重试复制最终提示词').click()
        assert len(claims) == 2
        assert not errors, errors
        assert not unexpected, unexpected
        browser.close()
        print(json.dumps(dict(ok=True, claims=len(claims), clipboard_retry_no_duplicate=True, report_visible=True, errors=errors)))
finally:
    server.shutdown()
    server.server_close()
