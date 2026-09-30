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
def _trash(v, n, tk, i, stopped, frm, mins, total=None, rid=None, reason=''):
    return {'id': f'{v}/{n}/{tk}/r{i}', 'ref': f'{v}/{n}/{tk}/r{i}', 'run_id': rid, 'vendor': v, 'model': n, 'task': tk[:3], 'variant': tk[3:] or None, 'tkey': tk, 'index': i, 'harness': 'Codex 桌面版',
            'at': iso(now - 60 * mins), 'reason': reason or ('手动彻底停止' if stopped else '移入回收站'), 'stopped': stopped, 'from': frm, 'started_at': iso(now - 60 * mins - 200), 'ended_at': iso(now - 60 * mins), 'total': total, 'graded': total is not None}
mstore['trash'] = [_trash('OpenAI', 'GPT-6.1-Sol', 'T01', 4, True, '进行中', 3), _trash('OpenAI', 'GPT-6.1-Sol', 'T03A', 2, False, '已交付', 45, reason='A 组误发成了 C 组提示词'),
                   _trash('Anthropic', 'claude-opus-5.5', 'T05', 4, False, '已完成', 60 * 26, total=71.4, rid='T05-9f2a1c3d')]
session = {'version': '1.0.0', 'token': 't', 'port': 41873, 'preview_ports': [41901, 41999], 'root': str(ROOT), 'python': 'python', 'desktop': False, 'started_at': now * 1000, 'github': 'https://github.com/AIMFllyYS/TryProtocom-Model-Compare',
           'paths': {'model': str(ROOT / 'model'), 'bench_data': str(ROOT / 'bench-data'), 'store': str(ROOT / 'data' / 'bench-store.json'), 'reports': str(ROOT / 'reports'), 'grader': str(ROOT / 'skills' / 'bench-grader'), 'skill': str(ROOT / 'skills' / 'bench-workbench'), 'agents_skills': str(ROOT / '.agents' / 'skills')}}
harness = [{'id': 'deepseek-harness', 'name': 'DeepSeek Harness', 'kind': 'app', 'icon': 'deepseek', 'path': 'C:/x/DeepSeek Harness.exe', 'installed': True}, {'id': 'claude-code', 'name': 'Claude Code', 'kind': 'cli', 'icon': 'claudecode', 'path': 'claude.cmd', 'installed': True},
           {'id': 'cursor', 'name': 'Cursor', 'kind': 'ide', 'icon': 'cursor', 'path': 'Cursor.exe', 'installed': True}, {'id': 'gemini-cli', 'name': 'Gemini CLI', 'kind': 'cli', 'icon': 'gemini', 'path': 'gemini.cmd', 'installed': True}]
prompt_head = '# 运行约定（Coding Bench v1.0 · T05 · 第 2 次运行）\n\n开始前请完整阅读本节，它与下面的题目原文同等重要。\n\n1. **工作目录**：`' + str(ROOT / 'model/OpenAI/GPT-6.1-Sol/T05/r2') + '`。只在这个目录里创建和修改文件。\n2. **交付文件夹**：在工作目录下新建 `aether9-site/`，名称必须完全一致。\n3. **完成时必须存在**：\n   - `aether9-site/package.json`\n   - `aether9-site/dist/index.html`\n4. **结束方式**：保存为 `FINAL_MESSAGE.md`。\n5. **时间上限**：120 分钟。\n\n---\n\n'

def api(path, q):
    if path == '/api/jobs' and MOCK_JOBS: return MOCK_JOBS
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
    if path == '/api/ws/claim':
        w = dict(workspaces[0]); w['started_at'] = iso(time.time()); w['index'] = 2; w['ref'] = 'OpenAI/GPT-6.1-Sol/T05/r2'
        return {'run': w, 'text': prompt_head, 'opened': '已启动 DeepSeek Harness'}
    if path == '/api/pet/feed':
        live = [w for w in workspaces if not w['grader_run_id']]
        brief = lambda w: {'ref': w['ref'], 'tkey': w['tkey'], 'index': w['index'], 'name': w['task'], 'vendor': w['vendor'], 'model': w['model'], 'harness': w['harness'], 'started_at': w['started_at'], 'ended_at': w['ended_at'], 'detect': {'done': w['detect']['done'], 'total': w['detect']['total'], 'final': w['detect']['final']}}
        return {'at': now * 1000, 'current': {'key': 'OpenAI/GPT-6.1-Sol', 'vendor': 'OpenAI', 'model': 'GPT-6.1-Sol', 'harness': 'DeepSeek Harness', 'tasks': 8, 'runs_per_task': 3, 'delivered': 20, 'graded': 18},
                'running': [brief(w) for w in live if w['ended_at'] is None], 'delivered': [brief(w) for w in live if w['ended_at']], 'grading': 1, 'pending': agg['pending'], 'jobs': ['评分：T05-2211-3'], 'top': [{'entrant': b['entrant'], 'quality': b['quality'], 'rank': b['rank']} for b in board[:3]]}
    if path == '/api/session': return session
    return {}

from urllib.parse import urlparse, parse_qs
# 登记 / 自动评分进度场景：一个正在评分、一个排队登记、一个评分失败
MOCK_JOBS, MOCK_LINES = [], []
if ONLY and 'grading' in ONLY:
    gw = [w for w in workspaces if w['model'] == 'GPT-6.1-Sol']
    A = next(w for w in gw if w['grader_run_id']); C = [w for w in gw if w['grader_run_id']][3]
    B = next(w for w in gw if not w['grader_run_id'] and w['ended_at'])
    ms = now * 1000
    MOCK_JOBS = [
        {'id': 'jg', 'kind': 'grade', 'title': f"评分：{A['grader_run_id']}", 'status': 'running', 'started_at': ms - 42000, 'queued_at': ms - 45000, 'ended_at': None, 'code': None, 'lines': 4, 'subject': {'refs': [A['ref']], 'run_ids': [A['grader_run_id']]}},
        {'id': 'jr', 'kind': 'register', 'title': f"登记：{B['ref']}", 'status': 'queued', 'started_at': ms - 9000, 'queued_at': ms - 9000, 'ended_at': None, 'code': None, 'lines': 0, 'subject': {'refs': [B['ref']]}},
        {'id': 'jf', 'kind': 'grade', 'title': f"评分：{C['grader_run_id']}", 'status': 'failed', 'started_at': ms - 200000, 'queued_at': ms - 200000, 'ended_at': ms - 60000, 'code': 1, 'lines': 9, 'error': 'probe browser crashed: TimeoutError', 'subject': {'refs': [C['ref']], 'run_ids': [C['grader_run_id']]}},
    ]
    MOCK_LINES = [{'type': 'job-line', 'id': 'jg', 'line': l} for l in ['$ python bench.py grade …', f"[probe 1/5] files {A['grader_run_id']}", f"[probe 2/5] build {A['grader_run_id']}", f"[probe 3/5] browser {A['grader_run_id']}"]]
    QA_REFS = (A['ref'], B['ref'], C['ref'])

def handle(route):
    u = urlparse(route.request.url)
    if u.path.startswith('/api/'):
        if u.path == '/api/events':
            body = 'retry: 600000\ndata: {"type":"hello","at":0}\n\n' + ''.join('data: ' + json.dumps(e, ensure_ascii=False) + '\n\n' for e in MOCK_LINES)
            return route.fulfill(status=200, headers={'content-type': 'text/event-stream; charset=utf-8'}, body=body)
        if route.request.method == 'POST' and u.path.startswith('/api/runs/') and u.path.endswith('/manual'):
            # 模拟人工分保存：稍慢一点（400ms），检验界面是否乐观更新、不等回执
            rid = u.path.split('/')[3]
            b = json.loads(route.request.post_data or '{}')
            run = next(r for r in runs if r['run_id'] == rid)
            if b.get('score') in ('', None): run['manual'].pop(b['item'], None)
            else: run['manual'][b['item']] = {'score': float(b['score']), 'note': b.get('note', ''), 'by': 'human'}
            for it in run['score']['items']:
                if it['id'] == b['item']:
                    it['status'] = 'scored' if b['item'] in run['manual'] else 'pending'; it['s'] = (run['manual'][b['item']]['score'] / 3) if b['item'] in run['manual'] else None
            time.sleep(0.4)
            return route.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True, 'score': run['score'], 'manual': run['manual']}, ensure_ascii=False))
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
        if not ONLY or 'launch' in ONLY:
            page.goto('http://wb.local/#/models', timeout=20000); page.wait_for_timeout(700)
            page.get_by_role('button', name='开始测评').first.click(); page.wait_for_timeout(900)
            page.screenshot(path=str(OUT / f'{theme}-launch.png'))
            cap = page.locator('.capsule').bounding_box(); dock = page.locator('.dock-t').first.bounding_box()
            if cap and dock:
                page.mouse.move(cap['x'] + cap['width'] / 2, cap['y'] + 40); page.mouse.down()
                for k in range(1, 11):
                    page.mouse.move(cap['x'] + cap['width'] / 2 + (dock['x'] + 60 - cap['x'] - cap['width'] / 2) * k / 10, cap['y'] + 40 + (dock['y'] + 20 - cap['y'] - 40) * k / 10); page.wait_for_timeout(30)
                page.screenshot(path=str(OUT / f'{theme}-launch-drag.png'))
                page.mouse.up(); page.wait_for_timeout(900)
                page.screenshot(path=str(OUT / f'{theme}-launch-stamp.png'))
        if not ONLY or 'trash' in ONLY:
            page.goto('http://wb.local/#/runs', timeout=20000); page.wait_for_timeout(900)
            card = page.locator('.run-card.live').first
            card.hover(); page.wait_for_timeout(250)
            bb = card.bounding_box()
            page.mouse.click(bb['x'] + 60, bb['y'] + 30, button='right'); page.wait_for_timeout(450)
            page.screenshot(path=str(OUT / f'{theme}-ctx.png'))
            page.keyboard.press('Escape'); page.wait_for_timeout(200)
            page.evaluate("document.body.classList.add('dragging-run')"); page.wait_for_timeout(400)
            page.screenshot(path=str(OUT / f'{theme}-dock-drag.png'))
            page.evaluate("document.querySelector('.trash-dock').classList.add('over')"); page.wait_for_timeout(350)
            page.screenshot(path=str(OUT / f'{theme}-dock-over.png'), clip={'x': 900, 'y': 700, 'width': 600, 'height': 240})
            page.evaluate("document.body.classList.remove('dragging-run'); document.querySelector('.trash-dock').classList.remove('over')")
            page.locator('.trash-dock').click(); page.wait_for_timeout(700)
            page.screenshot(path=str(OUT / f'{theme}-trash.png'))
            page.get_by_role('button', name='清空').click(); page.wait_for_timeout(500)
            page.screenshot(path=str(OUT / f'{theme}-purge.png'))
            page.locator('.ack .check').click(); page.wait_for_timeout(250)
            page.screenshot(path=str(OUT / f'{theme}-purge-ack.png'))
            page.keyboard.press('Escape'); page.wait_for_timeout(200); page.keyboard.press('Escape'); page.wait_for_timeout(200)
            page.goto('http://wb.local/#/runs/OpenAI/GPT-6.1-Sol/T01/r4', timeout=20000); page.wait_for_timeout(700)
            page.screenshot(path=str(OUT / f'{theme}-trashed-detail.png'))
        if not ONLY or 'score' in ONLY:
            sr = next(r for r in runs if r['model'] == 'GPT-6.1-Sol' and sum(i['method'] == 'human' for i in r['score']['items']) >= 3)
            for it in sr['score']['items']:
                if it['method'] == 'human': it['status'] = 'pending'; it['s'] = None
            sr['manual'] = {}
            page.goto(f"http://wb.local/#/stage?score={sr['run_id']}", timeout=20000); page.wait_for_timeout(900)
            page.screenshot(path=str(OUT / f'{theme}-score-0.png'))
            page.keyboard.press('2'); page.wait_for_timeout(120)   # 回执要 400ms：此刻应已显示选中
            page.screenshot(path=str(OUT / f'{theme}-score-picked.png'))
            page.wait_for_timeout(700)                              # 已自动跳到下一题
            page.locator('.ss-opt.s3').click(); page.wait_for_timeout(700)
            page.keyboard.press('n'); page.wait_for_timeout(150)
            page.keyboard.type('羽毛材质略糊'); page.wait_for_timeout(100)
            page.screenshot(path=str(OUT / f'{theme}-score-note.png'))
            page.keyboard.press('Enter'); page.wait_for_timeout(300)
            page.locator('.ss-opt.s1').click(); page.wait_for_timeout(900)
            page.locator('.ss-pill').nth(2).click(); page.wait_for_timeout(300)
            page.screenshot(path=str(OUT / f'{theme}-score-back.png'))
            got = {k: v for k, v in sr['manual'].items()}
            errors.append(f'[{theme}] score-check manual={json.dumps(got, ensure_ascii=False)}')
            for r in runs: r['manual'] = {} if r is sr else r['manual']
        if ONLY and 'grading' in ONLY:
            page.goto('http://wb.local/#/runs', timeout=20000); page.wait_for_timeout(1200)
            page.screenshot(path=str(OUT / f'{theme}-grading-board.png'))
            for k, ref in zip(('running', 'queued', 'failed'), QA_REFS):
                page.goto('http://wb.local/#/runs/' + ref, timeout=20000); page.wait_for_timeout(1000)
                page.screenshot(path=str(OUT / f'{theme}-grading-{k}.png'), clip={'x': 270, 'y': 0, 'width': 1230, 'height': 560})
        if not ONLY or 'pet' in ONLY:
            page.goto('http://wb.local/pet.html', timeout=20000); page.wait_for_timeout(900)
            page.screenshot(path=str(OUT / f'{theme}-pet-orb.png'))
            page.locator('.orb').click(); page.wait_for_timeout(600)
            page.screenshot(path=str(OUT / f'{theme}-pet-panel.png'))
        ctx.close()
    b.close()
(OUT / 'errors.txt').write_text('\n'.join(errors) or 'no errors', 'utf-8')
print('done', len(errors), 'errors')
os._exit(0)
