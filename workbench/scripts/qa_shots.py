# 视觉验收：不启动任何服务。Playwright 拦截请求——静态文件读 dist/，/api/* 返回模拟数据——逐页截图后退出。
import json, os, sys, threading, random, time, mimetypes
from pathlib import Path
from playwright.sync_api import sync_playwright

threading.Timer(float(os.environ.get('QA_TIMEOUT', '420')), lambda: os._exit(3)).start()  # 硬超时，防止卡住
ROOT = Path(sys.argv[1]).resolve()          # 仓库根
OUT = Path(sys.argv[2]).resolve(); OUT.mkdir(parents=True, exist_ok=True)
ONLY = sys.argv[3].split(',') if len(sys.argv) > 3 and sys.argv[3] else None
DIST = ROOT / 'workbench' / 'dist'
store = json.loads((ROOT / 'data' / 'bench-store.json').read_text('utf-8'))
spec = store['spec']
random.seed(7)
QD = [d['id'] for d in spec['dims'] if d['kind'] == 'quality']
TK = []
for t in spec['tasks']:
    vs = list(t['variants'].keys())
    TK += [t['id'] + v for v in vs] if vs else [t['id']]

MODELS = [('OpenAI', 'GPT-6.1-Sol', 'DeepSeek Harness'), ('Anthropic', 'claude-opus-5.5', 'Claude Code'), ('Google', 'Gemini-3.5-Pro', 'Gemini CLI'),
          ('DeepSeek', 'DeepSeek-V4', 'DeepSeek Harness'), ('Moonshot', 'Kimi-K3', 'Kimi CLI'), ('Alibaba', 'Qwen4-Coder', 'OpenCode')]
now = time.time()
iso = lambda t: time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime(t))
models = [{'schema': 1, 'vendor': v, 'name': n, 'harness': h, 'created_at': iso(now - 86400 * 3)} for v, n, h in MODELS]
base = {'GPT-6.1-Sol': 78, 'claude-opus-5.5': 84, 'Gemini-3.5-Pro': 74, 'DeepSeek-V4': 69, 'Kimi-K3': 63, 'Qwen4-Coder': 58}

def task_items(tid):
    return next(t for t in spec['tasks'] if t['id'] == tid)['items']

runs, workspaces, agg_tasks = [], [], []
for v, n, h in MODELS:
    ent = f'{n} @ {h}'
    for tk in TK:
        tid = tk[:3]
        for r in range(1, 4):
            if n == 'Qwen4-Coder' and tid in ('T06', 'T07', 'T08'): continue
            score = max(5, min(98, base[n] + random.gauss(0, 9)))
            rid = f'{tid}-{abs(hash(ent)) % 9999:04d}-{r}'
            items = []
            for it in task_items(tid)[:14]:
                st = 'pending' if (it['method'] == 'human' and n == 'GPT-6.1-Sol' and tid == 'T05' and r == 1) else 'scored'
                items.append({'id': it['id'], 'dim': it['dim'], 'tier': it['tier'], 'method': it['method'], 'weight': it['weight'], 'desc': it['desc'], 'status': st, 's': None if st == 'pending' else round(random.random(), 2)})
            pend = [i['id'] for i in items if i['status'] == 'pending']
            sc = {'gate_pass': True, 'gate_fail': [], 'total': round(score, 1), 'dims': {d: round(max(0, min(100, score + random.gauss(0, 8))), 1) for d in QD}, 'dim_weights': {}, 'tiers': {'basic': 90, 'advanced': 70, 'excellent': 45},
                  'items': items, 'na_ratio': 0.03, 'low_confidence': False, 'pending': pend, 'complete': not pend, 'passed': score >= 60}
            ref = f'{v}/{n}/{tk}/r{r}'
            is_live = n == 'GPT-6.1-Sol' and tid in ('T06', 'T07')
            if not is_live:
                runs.append({'run_id': rid, 'task': tid, 'variant': tk[3:] or None, 'tkey': tk, 'model': n, 'vendor': v, 'harness': h, 'entrant': ent, 'run_index': r, 'date': iso(now - 3600 * r), 'alias': f'R{len(runs)+1:03d}',
                             'ws_ref': ref, 'graded': True, 'score': sc, 'usage': {'wall_min': round(random.uniform(8, 90), 1), 'cost_usd': round(random.uniform(.2, 6), 2)}, 'manual': {}, 'artifacts': {}, 'notes': [], 'dir': f'bench-data/runs/{rid}', 'has_final_message': True, 'synced_at': iso(now)})
            if n in ('GPT-6.1-Sol', 'claude-opus-5.5'):
                d = {'dir_exists': True, 'checks': [{'path': 'index.html', 'label': 'index.html', 'ok': True, 'optional': False}, {'path': 'README.md', 'label': 'README.md', 'ok': not is_live or r == 1, 'optional': False}], 'done': 2 if (not is_live or r == 1) else 1, 'total': 2, 'final': (not is_live) or r == 1, 'last_change': (now - 120) * 1000}
                workspaces.append({'schema': 1, 'ref': ref, 'vendor': v, 'model': n, 'task': tid, 'variant': tk[3:] or None, 'tkey': tk, 'index': r, 'harness': h, 'created_at': iso(now - 7200), 'started_at': iso(now - 1500 * r),
                                   'ended_at': None if is_live and r > 1 else iso(now - 300), 'deliverable_dir': next(t for t in spec['tasks'] if t['id'] == tid)['deliverable'], 'grader_run_id': None if is_live else rid,
                                   'workspace': str(ROOT / 'model' / v / n / tk / f'r{r}'), 'has_final': True, 'has_deliverable': True, 'entry': 'index.html', 'detect': d, 'auto_finished': is_live and r == 1})

board = []
for i, (v, n, h) in enumerate(sorted(MODELS, key=lambda m: -base[m[1]])):
    ent = f'{n} @ {h}'
    q = base[n] + random.uniform(-1.5, 1.5)
    board.append({'rank': str(i + 1) + ('=' if i == 2 else ''), 'entrant': ent, 'model': n, 'vendor': v, 'harness': h, 'quality': round(q, 1), 'ci_low': round(q - 3.5, 1), 'ci_high': round(q + 3.2, 1),
                  'dims': {d: round(max(0, min(100, q + random.gauss(0, 10))), 1) for d in QD}, 'runs': 24, 'tasks': 9, 'pass_rate': round(min(1, q / 90), 2),
                  'suite_exp_cost_usd': round(random.uniform(4, 60), 2), 'suite_exp_min': round(random.uniform(90, 600), 0), 'cost_coverage': '24/24', 'complete': n != 'GPT-6.1-Sol', 'na_ratio': 0.02})
    for tk in TK:
        agg_tasks.append({'entrant': ent, 'task': tk, 'runs': 3, 'mean': round(max(0, min(100, q + random.gauss(0, 10))), 1), 'sd': round(random.uniform(1, 9), 1), 'min': 0, 'max': 0, 'pass_rate': 0.67, 'pass_at_k': True,
                          'gate_fail_runs': 0, 'complete': True, 'low_confidence': False, 'mean_cost_usd': 1, 'mean_min': 20, 'exp_cost_usd': 1.5, 'exp_min': 30, 'dims': {}, 'dim_weights': {}, 'tiers': {}, 'cost_score': 60, 'speed_score': 50})
agg = {'board': board, 'tasks': agg_tasks, 'items': [{'task': 'T05', 'item_id': 'T05-B01', 'dim': 'ui', 'tier': 'basic', 'method': 'auto', 'desc': '首屏 3 秒内出现 3D 画面', 'mean': .96, 'between_sd': .03, 'within_sd': .02, 'n': 18, 'flag': '天花板', 'by_entrant': {}}],
       'uplift': [], 'failures': [], 'entrants': [b['entrant'] for b in board], 'tkeys': TK, 'generated_at': iso(now), 'pending': {'human': 6, 'agent': 11, 'usage_missing': 2, 'ungraded': 0, 'low_confidence': 0}}
history = [{'at': iso(now - 60 * k), 'action': a, 'detail': d} for k, (a, d) in enumerate([('ws-create', 'OpenAI/GPT-6.1-Sol/T07/r2'), ('register', 'OpenAI/GPT-6.1-Sol/T05/r3 → T05-2211-3'), ('model', '新增/更新模型 Moonshot/Kimi-K3'), ('sync', '同步 96 次运行')])]
mstore = {**store, 'models': models, 'runs': runs, 'workspaces': workspaces, 'history': history, 'settings': {'current_model': 'OpenAI/GPT-6.1-Sol', 'default_harness': 'deepseek-harness'}}
session = {'version': '1.0.0', 'token': 't', 'port': 41873, 'preview_ports': [41901, 41999], 'root': str(ROOT), 'python': 'python', 'desktop': False, 'started_at': now * 1000, 'github': 'https://github.com/AIMFllyYS/TryProtocom-Model-Compare',
           'paths': {'model': str(ROOT / 'model'), 'bench_data': str(ROOT / 'bench-data'), 'store': str(ROOT / 'data' / 'bench-store.json'), 'reports': str(ROOT / 'reports'), 'grader': str(ROOT / 'skills' / 'bench-grader'), 'skill': str(ROOT / 'skills' / 'bench-workbench'), 'agents_skills': str(ROOT / '.agents' / 'skills')}}
harness = [{'id': 'deepseek-harness', 'name': 'DeepSeek Harness', 'kind': 'app', 'icon': 'deepseek', 'path': 'C:/x/DeepSeek Harness.exe', 'installed': True}, {'id': 'claude-code', 'name': 'Claude Code', 'kind': 'cli', 'icon': 'claudecode', 'path': 'claude.cmd', 'installed': True},
           {'id': 'cursor', 'name': 'Cursor', 'kind': 'ide', 'icon': 'cursor', 'path': 'Cursor.exe', 'installed': True}, {'id': 'gemini-cli', 'name': 'Gemini CLI', 'kind': 'cli', 'icon': 'gemini', 'path': 'gemini.cmd', 'installed': True}]
prompt_head = '# 运行约定（Coding Bench v1.0 · T05 · 第 2 次运行）\n\n开始前请完整阅读本节，它与下面的题目原文同等重要。\n\n1. **工作目录**：`' + str(ROOT / 'model/OpenAI/GPT-6.1-Sol/T05/r2') + '`。只在这个目录里创建和修改文件。\n2. **交付文件夹**：在工作目录下新建 `aether9-site/`，名称必须完全一致。\n3. **完成时必须存在**：\n   - `aether9-site/package.json`\n   - `aether9-site/dist/index.html`\n4. **结束方式**：保存为 `FINAL_MESSAGE.md`。\n5. **时间上限**：120 分钟。\n\n---\n\n'

def api(path, q):
    if path == '/api/session': return session
    if path == '/api/spec': return spec
    if path == '/api/store': return mstore
    if path == '/api/aggregate': return agg
    if path in ('/api/jobs', '/api/preview', '/api/procs', '/api/reports'): return [{'id': 'j1', 'kind': 'grade', 'title': '评分：全部运行', 'status': 'done', 'started_at': now * 1000 - 90000, 'ended_at': now * 1000 - 20000, 'code': 0, 'lines': 3}] if path == '/api/jobs' else []
    if path == '/api/harness': return harness
    if path == '/api/ws/prompt':
        t = next((x for x in spec['tasks'] if x['id'] == q.get('task', 'T05')), spec['tasks'][0])
        return {'text': prompt_head + t['prompt'], 'warnings': [], 'ref': 'OpenAI/GPT-6.1-Sol/T05/r2', 'workspace': str(ROOT / 'model/OpenAI/GPT-6.1-Sol/T05/r2'), 'index': 2, 'exists': False}
    if path == '/api/models/infer': return {'vendor': 'OpenAI', 'name': q.get('name', ''), 'inferred': True, 'icon': 'openai', 'harness': {'id': 'deepseek-harness', 'name': 'DeepSeek Harness'}, 'exists': False, 'vendors': ['OpenAI', 'DeepSeek']}
    if path == '/api/ws/final': return {'text': '交付了 aether9-site/，含源码与 dist/index.html。', 'prompt': prompt_head}
    if path.startswith('/api/runs/'): return {'run': runs[0], 'metrics': {}, 'final_message': '完成。', 'local': False}
    return {}

from urllib.parse import urlparse, parse_qs
def handle(route):
    u = urlparse(route.request.url)
    if u.path.startswith('/api/'):
        if u.path == '/api/events':
            return route.fulfill(status=200, headers={'content-type': 'text/event-stream'}, body='retry: 600000\ndata: {"type":"hello","at":0}\n\n')
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        return route.fulfill(status=200, content_type='application/json', body=json.dumps(api(u.path, q), ensure_ascii=False))
    p = DIST / (u.path.lstrip('/') or 'index.html')
    if not p.is_file(): p = DIST / 'index.html'
    ct = mimetypes.guess_type(str(p))[0] or 'application/octet-stream'
    if p.suffix == '.js': ct = 'text/javascript'
    route.fulfill(status=200, content_type=ct, body=p.read_bytes())

PAGES = [('overview', ''), ('models', 'models'), ('model', 'models/OpenAI/GPT-6.1-Sol'), ('tasks', 'tasks/T05'), ('runs', 'runs'), ('run', 'runs/OpenAI/GPT-6.1-Sol/T05/r1'),
         ('board', 'board'), ('compare', 'compare'), ('exports', 'exports'), ('docs', 'docs'), ('settings', 'settings/harness'), ('stage', 'stage')]
errors = []
with sync_playwright() as pw:
    b = pw.chromium.launch(args=['--force-color-profile=srgb'])
    for theme in os.environ.get('QA_THEMES', 'light,dark').split(','):
        ctx = b.new_context(viewport={'width': int(os.environ.get('QA_W', '1500')), 'height': int(os.environ.get('QA_H', '940'))}, device_scale_factor=1)
        ctx.add_init_script(f"localStorage.setItem('wb.theme', JSON.stringify('{theme}')); localStorage.setItem('wb.current', 'OpenAI/GPT-6.1-Sol');")
        ctx.route('http://wb.local/**', handle)
        page = ctx.new_page()
        page.on('console', lambda m: errors.append(f'[{theme}] console.{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
        page.on('pageerror', lambda e: errors.append(f'[{theme}] pageerror: {e}'))
        for name, h in PAGES:
            if ONLY and name not in ONLY: continue
            page.goto(f'http://wb.local/#/{h}', timeout=20000)
            page.wait_for_timeout(900)
            page.screenshot(path=str(OUT / f'{theme}-{name}.png'))
        if not ONLY or 'dialogs' in ONLY:
            page.goto('http://wb.local/#/models', timeout=20000); page.wait_for_timeout(600)
            page.get_by_role('button', name='新增模型').first.click(); page.wait_for_timeout(300)
            page.keyboard.type('GPT-6.1-Sol'); page.wait_for_timeout(700)
            page.screenshot(path=str(OUT / f'{theme}-addmodel.png'))
            page.keyboard.press('Escape'); page.wait_for_timeout(200)
            page.goto('http://wb.local/#/tasks/T05', timeout=20000); page.wait_for_timeout(700)
            page.locator('.dispatch-for .select').nth(1).click(); page.wait_for_timeout(400)
            page.screenshot(path=str(OUT / f'{theme}-select.png'))
        ctx.close()
    b.close()
(OUT / 'errors.txt').write_text('\n'.join(errors) or 'no errors', 'utf-8')
print('done', len(errors), 'errors')
os._exit(0)
