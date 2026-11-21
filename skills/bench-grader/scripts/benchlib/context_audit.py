"""评测侧独立上下文审计。默认只读，保存仅写 context-audits，不导入评分流水线。"""
from __future__ import annotations

from datetime import datetime, timezone
import json
import ntpath
import os
from pathlib import Path
import posixpath
import re
import subprocess
from urllib.parse import unquote, urlsplit
import uuid

from .context_logs import command_text, digest, file_hash, parse_log

POLICY_VERSION = 'context-boundary/v1'
POLICY_START = '<!-- benchmark-context-boundary:v1:start -->'
POLICY_END = '<!-- benchmark-context-boundary:v1:end -->'
POLICY_BLOCK = f'''{POLICY_START}
## 本次测评的上下文边界
- 仅依据本题、随题材料、本工作目录内本轮生成的内容及原题允许的公共技术资料独立完成。
- 不检索、读取或引用跨会话记忆、历史对话、其他运行的产物或解题经验，以及评分器、隐藏测试和评分结果；不得通过终端、搜索、浏览器、MCP或子智能体间接获取，也不主动把本轮内容写入共享记忆。
- Skill仅限本题明确提供或指定者；未指定即不用。不调用其他全局或个人技能，不搜索安装新技能，不复制其内容进本目录绕过限制；原题A/C条件不变。
- 原题允许的终端、浏览器、依赖、编译器和工具帮助可正常使用；不借此浏览其他项目或更改个人harness配置。
- 若相关历史信息已自动注入或意外读到，停止继续获取，不引用或据此优化，仍继续交付；在已有的FINAL_MESSAGE.md中说明来源类别和受影响环节，不复述相关内容，不声称已清除污染。子智能体同样遵守。
{POLICY_END}

'''.encode('utf-8')
REF = re.compile(r'^[^/\\]+/[^/\\]+/(?:T\d{2}|B[1-8]|V\d{2})[AC]?/r[1-9]\d*$')
RUN_ID = re.compile(r'^[A-Za-z0-9_-]+$')
MEMORY = re.compile(r'(?:^|[/\\.])memor(?:y|ies)(?:[/\\.]|$)|跨会话记忆|历史任务信息', re.I)
SELF_REPORT = re.compile(r'(?:意外|自动注入|读到|读取了|已使用|参考了).{0,60}(?:历史|其他运行|记忆|全局技能)|(?:历史|记忆).{0,40}(?:提示了|据此|污染)', re.I)
INFRA = re.compile(r'(?:^|/)(?:bench-data|hidden|rubric\.ya?ml|bench-grader|bench-workbench|score\.json|metrics\.json)(?:/|$)|/data/bench-store\.json', re.I)
READ_TOOL = re.compile(r'read|search|grep|glob|fetch|browse|navigate|open|shell|bash|terminal|command|exec|skill|memory|recall|agent|delegate|parallel', re.I)
PATH_TOKEN = re.compile(r'''file://[^\s<>"'`]+|https?://[^\s<>"'`]+|["']([^"'\r\n]+)["']|(?:[A-Za-z]:[\\/]|/|\.\.?[\\/])[^\s"'`;|<>]+''')


def normalize_path(value, cwd=''):
    value = str(value)
    if value.lower().startswith('file:'):
        u = urlsplit(value)
        value = unquote(u.path)
        if u.netloc and u.netloc.lower() != 'localhost':
            value = '//' + u.netloc + value
        elif re.match(r'^/[A-Za-z]:', value):
            value = value[1:]
    windows = bool(re.match(r'^[A-Za-z]:', value) or '\\' in value or re.match(r'^[A-Za-z]:', cwd))
    mod = ntpath if windows else posixpath
    if cwd and not mod.isabs(value):
        value = mod.join(cwd, value)
    value = mod.normpath(value).replace('\\', '/')
    return value.casefold() if windows else value


def within(value, root):
    if not root:
        return False
    a, b = normalize_path(value), normalize_path(root).rstrip('/')
    return a == b or a.startswith(b + '/')


def linked(path, root):
    """不跟随工作区链接；包括 Windows junction 和中间路径链接。"""
    path, root = Path(path).absolute(), Path(root).absolute()
    if not path.is_relative_to(root):
        return True
    for p in [path, *path.parents]:
        if p.is_symlink() or (hasattr(p, 'is_junction') and p.is_junction()):
            return True
        if p.exists() and p.resolve() != p:
            return True
        if p == root:
            break
    return False


def child_dirs(path, root):
    """进入目录前逐层拒绝链接，不用 glob 先枚举宿主目录再排除。"""
    if linked(path, root):
        return []
    try:
        entries = sorted(path.iterdir())
    except OSError:
        return []
    return [p for p in entries if not linked(p, root) and p.is_dir()]


def read_json(path):
    try:
        return json.loads(Path(path).read_text('utf-8-sig'))
    except (OSError, ValueError):
        return {}


def redact(value):
    value = re.sub(r'(?i)Bearer\s+[^\s;,"\']+', 'Bearer [redacted]', str(value))
    value = re.sub(r'''(?i)(api[_-]?key|token|password|authorization|secret)["']?\s*[=:]\s*["']?[^\s&;,}"']+''', r'\1=[redacted]', value)
    value = re.sub(r'(?i)(https?://)[^/@\s]+:[^/@\s]+@', r'\1[redacted]@', value)
    value = re.sub(r'(?i)(/users/|/home/|\\users\\)[^/\\]+', r'\1[user]', value)
    return value[:350]


def now():
    return datetime.now(timezone.utc).isoformat()


def result(status, *notes):
    return {'status': status, 'notes': list(notes)}


def _targets(args):
    found = []
    for key, value in args.items():
        if isinstance(value, dict):
            found.extend(_targets(value))
        elif isinstance(value, list):
            for item in value:
                found.extend(_targets({key: item}))
        elif isinstance(value, str):
            if key.lower() in {'path', 'file_path', 'filepath', 'url', 'target', 'uri'}:
                found.append(value)
            else:
                for m in PATH_TOKEN.finditer(value):
                    v = m.group(1) or m.group(0)
                    if '/' in v or '\\' in v or MEMORY.search(v):
                        found.append(v)
    return list(dict.fromkeys(found))


def classify(event, workspace, policy, model_root):
    """只产生待复核观察；没有自动确认或扣分分支。"""
    tool, args = event['tool'], event['arguments']
    if event['role'] not in {'assistant', 'model', 'subagent', 'system', 'developer'}:
        return []
    operation = event['operation']
    body = args.get('text', '') if operation != 'tool' else ''
    if operation == 'message':
        return [('self_report', 'self_report', '')] if SELF_REPORT.search(body) else []
    if operation == 'injection':
        if MEMORY.search(body) and SELF_REPORT.search(body):
            return [('historical_information', 'injected', '')]
        if re.search(r'<(?:invoked_skill|skill_content)\b|Base directory for this skill:', body, re.I):
            return [('skill_injection', 'injected', '')]
        return []
    if not READ_TOOL.search(tool) or re.search(r'list.?tabs|list.?pages', tool, re.I):
        return []
    command = command_text(args)
    if re.match(r'^\s*(?:cd|Set-Location)\s+[^;|&\n]+$', command, re.I):
        return []
    hits = []
    skill = (policy or {}).get('skills', {})
    if re.search(r'(?:^|[.:/])skill$', tool, re.I):
        name = args.get('skill', args.get('skill_name', args.get('name')))
        if isinstance(name, str) and name not in skill.get('names', []):
            hits.append(('unauthorized_skill' if policy else 'auxiliary_skill', event['status'], name))
    delegated = bool(re.search(r'(?:^|[.:/])(?:agent|delegate|parallel)$', tool, re.I))
    for target in _targets(args):
        p = normalize_path(target, event.get('cwd') or workspace)
        kind = None
        if MEMORY.search(p):
            kind = 'memory'
        elif INFRA.search(p):
            kind = 'evaluation_data'
        elif re.search(r'(?i)(?:^|/)skills/[^/]+(?:/|$)|/SKILL\.md$', p):
            declared_roots = [f'{base}/{name}' for base in ('skills', '.agents/skills') for name in skill.get('names', [])]
            allowed = any(within(p, normalize_path(root, workspace)) for root in declared_roots + skill.get('roots', []))
            # 没有发车前快照只意味着未知，不能据运行后目录授权。
            if not allowed:
                kind = 'unauthorized_skill' if policy else 'auxiliary_skill'
        elif not within(p, workspace) and within(p, str(model_root)):
            kind = 'other_run'
        elif re.search(r'/(?:T\d{2}|B[1-8]|V\d{2})[AC]?/r\d+(?:/|\.|$)', p, re.I) and not within(p, workspace):
            kind = 'other_run'
        if target.startswith(('http://', 'https://')):
            u = urlsplit(target)
            if u.hostname in {'127.0.0.1', 'localhost', '::1'} and u.port == int(os.environ.get('WB_PORT', '41873')) and re.match(r'/api/(?:store|runs|ws|fs|spec|aggregate|models|context)(?:/|$)', u.path):
                kind = 'evaluation_data'
            elif not kind:
                continue  # 未知端口不推定为他人任务，自检服务正常。
        if kind:
            observation = 'mention' if operation == 'candidate' else 'attempt' if delegated else event['status']
            hits.append((kind, observation, target))
    if re.search(r'memory|recall', tool, re.I):
        write = re.search(r'update|write|create|save|store', tool, re.I)
        hits.append(('shared_memory_write' if write else 'memory', event['status'], 'memory tool'))
    elif re.search(r'\b(?:Set-Content|Add-Content|Out-File|tee)\b|>>?', str(args.get('command', '')), re.I):
        hits = [('shared_memory_write' if k == 'memory' else k, s, t) for k, s, t in hits]
    return list(dict.fromkeys(hits))


class Repository:
    def __init__(self, root, data=None, model=None):
        self.root = Path(root).absolute()
        self.data = Path(data).absolute() if data else self.root / 'bench-data'
        self.model = Path(model).absolute() if model else self.root / 'model'

    def resolve(self, target):
        if REF.fullmatch(target) and not any(x in {'.', '..'} for x in target.split('/')):
            ws = self.model.joinpath(*target.split('/'))
            meta_path = ws.with_suffix('.run.json')
            if linked(meta_path, self.model):
                raise ValueError('运行登记经过链接')
            meta = read_json(meta_path)
            if not meta:
                raise ValueError('缺少或损坏的运行登记')
            return dict(ref=target, workspace=ws, meta=meta, meta_path=meta_path, run_id=meta.get('grader_run_id'))
        if not RUN_ID.fullmatch(target):
            raise ValueError('不合法的 ref / run_id')
        mp = self.data / 'runs' / target / 'meta.json'
        if linked(mp, self.data):
            raise ValueError('运行记录经过链接')
        m = read_json(mp)
        ref = m.get('extra', {}).get('ws_ref') or m.get('ws_ref')
        if ref:
            try:
                return self.resolve(ref)
            except ValueError:
                pass
        # 兼容直接登记的运行：只接受 model 根内且符合 ref 结构的工作区。
        raw_ws = m.get('workspace')
        if raw_ws and within(normalize_path(raw_ws), str(self.model)):
            rel = normalize_path(raw_ws)[len(normalize_path(str(self.model)).rstrip('/')) + 1:]
            if REF.fullmatch(rel):
                try:
                    return self.resolve(rel)
                except ValueError:
                    pass
        if not m:
            raise ValueError('运行不存在')
        return dict(ref=None, workspace=None, meta=m, meta_path=mp, run_id=target)

    def all_targets(self):
        targets, seen = [], set()
        # 固定四层；每层都在 iterdir 之前拒绝链接，不枚举链接后的宿主目录。
        for vendor in child_dirs(self.model, self.model):
            for model in child_dirs(vendor, self.model):
                for task in child_dirs(model, self.model):
                    try:
                        entries = sorted(task.iterdir())
                    except OSError:
                        continue
                    for p in entries:
                        if not re.fullmatch(r'r[1-9]\d*\.run\.json', p.name) or linked(p, self.model) or not p.is_file():
                            continue
                        m = read_json(p)
                        ref = p.relative_to(self.model).as_posix().removesuffix('.run.json')
                        if m and not m.get('discarded') and REF.fullmatch(ref):
                            targets.append(ref)
                        if m.get('grader_run_id'):
                            seen.add(m['grader_run_id'])
        runs = self.data / 'runs'
        for directory in child_dirs(runs, self.data):
            p = directory / 'meta.json'
            if not linked(p, self.data) and p.is_file() and directory.name not in seen and not read_json(p).get('discarded'):
                targets.append(directory.name)
        return targets

    def preflight(self, target):
        r = self.resolve(target)
        ws, m = r['workspace'], r['meta']
        policy = m.get('context_policy')
        out = dict(ref=r['ref'], run_id=r['run_id'], policy_version=policy.get('version') if policy else 'legacy',
                   prompt=result('unknown', '无提示词存档'), workspace=result('unknown', '工作区不可用'),
                   skills=result('unknown', '没有发车前技能快照'), global_injection='unknown', blocking=False)
        if ws is None:
            return out
        pf = ws.with_suffix('.prompt.md')
        if pf.exists() and not linked(pf, self.model):
            data = pf.read_bytes()
            if not policy:
                marked = b'benchmark-context-boundary:' in data
                if marked:
                    out['policy_version'] = 'unknown'
                out['prompt'] = result('warning', '缺少来源记录，约束版本未知' if marked else '旧版约束，未增强；不回写存档')
            else:
                size = len(POLICY_BLOCK)
                checks = [policy.get('version') == POLICY_VERSION, data.startswith(POLICY_BLOCK),
                          data.count(POLICY_START.encode()) == 1, data.count(POLICY_END.encode()) == 1,
                          policy.get('policy_sha256') == digest(POLICY_BLOCK),
                          policy.get('prompt_sha256') == digest(data),
                          policy.get('base_prompt_sha256') == digest(data[size:]),
                          policy.get('insertion') == dict(offset=0, byte_length=size)]
                out['prompt'] = result('pass' if all(checks) else 'error', '约束、字节位置及来源哈希核对；发送文本仍未核验')
            if re.search(rb'\{[A-Z][A-Z_]{2,}\}', data):
                out['prompt'] = result('error', '含未替换占位符')
        else:
            out['prompt'] = result('error', '提示词缺失或经过链接')
        vendor, model, task, run_name = r['ref'].split('/')
        identity = m.get('vendor', vendor) == vendor and m.get('model', model) == model and m.get('task', task) + (m.get('variant') or '') == task and str(m.get('index', run_name[1:])) == run_name[1:]
        aligned = (identity and m.get('ref', r['ref']) == r['ref'] and ws.is_dir() and not linked(ws, self.model))
        try:
            git = subprocess.run(['git', '-C', str(ws), 'rev-parse', '--show-toplevel'], capture_output=True,
                                 timeout=10, encoding='utf-8', creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            independent = git.returncode == 0 and normalize_path(git.stdout.strip()) == normalize_path(str(ws)) and (ws / '.git').is_dir()
        except (OSError, subprocess.TimeoutExpired):
            independent = False
        out['workspace'] = result('pass' if aligned and independent else 'error', '仅验证登记目录及独立 Git 根，不证明操作系统隔离')
        if policy:
            s = policy.get('skills', {})
            unexpected, unsafe, mismatched = [], [], []
            for base in ('skills', '.agents/skills'):
                bp = ws / base
                if linked(bp, ws):
                    unsafe.append(base)
                    continue
                if bp.is_dir():
                    for p in bp.iterdir():
                        if p.name not in s.get('names', []):
                            unexpected.append(p.name)
            for rel, expected in s.get('files', {}).items():
                p = ws / rel
                if linked(p, ws):
                    unsafe.append(rel)
                elif not p.is_file() or file_hash(p) != expected:
                    mismatched.append(rel)
            if unexpected:
                out['skills'] = result('warning', '发现未登记的本地技能目录：' + ', '.join(map(redact, unexpected)))
            elif unsafe or mismatched:
                out['skills'] = result('unknown', '技能快照不可核验：链接、缺失或内容改变')
            elif s.get('mode') == 'none':
                out['skills'] = result('pass', '本题未指定技能；未观察到主动准备的额外本地技能，不检查全局配置')
            elif s.get('status') == 'recorded' and s.get('files'):
                try:
                    captured = datetime.fromisoformat(s['captured_at'].replace('Z', '+00:00')).timestamp()
                    launch = datetime.fromisoformat((m.get('started_at') or m['created_at']).replace('Z', '+00:00')).timestamp()
                    timely = captured <= launch + 2
                except (KeyError, ValueError, TypeError):
                    timely = False
                out['skills'] = result('pass', '已登记的发车前文件快照一致') if timely else result('unknown', '快照时间缺失或晚于开跑；不冒充发车前证据')
            else:
                out['skills'] = result('unknown', '指定技能待准备或发车前快照缺失，不以运行后内容补写')
            if policy.get('materials', {}).get('status') == 'unknown' and out['workspace']['status'] == 'pass':
                out['workspace'] = result('warning', '随题清单快照不完整，准备材料覆盖未知')
            # 素材快照只核对已登记清单，不跟随工作区链接。
            for rel, expected in policy.get('materials', {}).get('files', {}).items():
                p = ws / rel
                if linked(p, ws) or not p.is_file() or file_hash(p) != expected:
                    if out['workspace']['status'] != 'error':
                        out['workspace'] = result('warning' if m.get('started_at') else 'error', '随题清单有链接、缺失或变化；运行后修改不作为污染证据')
                    break
        out['blocking'] = any(out[k]['status'] == 'error' for k in ('prompt', 'workspace'))
        return out

    def log_paths(self, r, explicit):
        paths = {}
        ws = r['workspace']
        if ws:
            for suffix in ('.codex.jsonl', '.agy.jsonl', '.agent.jsonl', '.jsonl', '.transcript.jsonl', '.log'):
                p = ws.with_suffix(suffix)
                if p.is_file() and not linked(p, self.model):
                    paths[str(p)] = 'archived'
        if r['run_id']:
            rd = self.data / 'runs' / r['run_id']
            for pattern in ('transcript*', 'agent_log*', 'logs/*'):
                for p in rd.glob(pattern):
                    if p.is_file() and not linked(p, self.data):
                        paths[str(p)] = 'archived'
        for p in r['meta'].get('usage', {}).get('log_files', []):
            paths.setdefault(str(Path(p).absolute()), 'recorded')
        for p in explicit or []:
            paths[str(Path(p).absolute())] = 'explicit'
        return paths

    def association(self, parsed, r, origin, prompt_hash):
        m, expected = parsed['metadata'], r['meta']
        contexts = parsed.get('contexts', [])
        if len({c.get('session') for c in contexts if c.get('session')}) > 1:
            return 'mismatch'
        if r['workspace'] and any(c.get('cwd') and normalize_path(c['cwd']) != normalize_path(str(r['workspace'])) for c in contexts):
            return 'mismatch'
        cwd = m.get('cwd')
        if cwd and r['workspace'] and normalize_path(cwd) != normalize_path(str(r['workspace'])):
            return 'mismatch'
        sid = expected.get('session_id', expected.get('conversation_id'))
        if sid and m.get('session') and str(sid) != str(m['session']):
            return 'mismatch'
        model = expected.get('usage', {}).get('log_model', expected.get('model_id'))
        if model and (m.get('model') or m.get('model_id')) and model != m.get('model', m.get('model_id')):
            return 'mismatch'
        if m.get('timestamp') and expected.get('started_at') and expected.get('ended_at'):
            try:
                stamp = datetime.fromisoformat(m['timestamp'].replace('Z', '+00:00')).timestamp()
                start = datetime.fromisoformat(expected['started_at'].replace('Z', '+00:00')).timestamp()
                end = datetime.fromisoformat(expected['ended_at'].replace('Z', '+00:00')).timestamp()
                if stamp < start - 300 or stamp > end + 300:
                    return 'mismatch'
            except (ValueError, TypeError):
                return 'unknown'
        matched_prompt = prompt_hash and prompt_hash in parsed['prompts']
        if origin == 'recorded':
            return 'verified' if cwd and (matched_prompt or sid and m.get('session') == sid) else 'unknown'
        return 'verified' if cwd and matched_prompt else origin

    def audit(self, target, logs=None, save=False):
        r = self.resolve(target)
        ws, m = r['workspace'], r['meta']
        policy = m.get('context_policy')
        pre = self.preflight(target)
        out = dict(schema='context-audit/1', auditor_version='1', ref=r['ref'], run_id=r['run_id'], created_at=now(),
                   policy_version=pre['policy_version'], preflight=pre, sources=[], findings=[],
                   coverage=dict(tools='missing', initial_context='unknown'),
                   prompt_provenance=dict(archive='consistent' if pre['prompt']['status'] == 'pass' else pre['prompt']['status'], sent='unknown'),
                   notes=['没有命中不代表上下文干净；未观察到的全局自动注入保持未知。', '独立审计不改变 AC13、评分、事故状态或采样。', '旧 AC13 的 file URL 编码与空格路径问题需独立复核，见 docs/probe-issues.md P-19；本报告不自动覆盖旧结论。'], stale=False)
        pf = ws.with_suffix('.prompt.md') if ws else None
        ph = file_hash(pf) if pf and pf.is_file() and not linked(pf, self.model) else None
        partial, supported, terminal, sent_hashes, seen = False, 0, False, [], set()
        for name, origin in self.log_paths(r, logs).items():
            p = Path(name)
            # 明确日志也不追踪目录联接，防止归档路径在审核过程中换指向。
            if linked(p, Path(p.anchor)):
                out['sources'].append(dict(path=redact(name), sha256=None, association='unknown', errors=['日志经过链接']))
                partial = True
                continue
            parsed = parse_log(p)
            assoc = self.association(parsed, r, origin, ph)
            stat = p.stat() if p.exists() else None
            src = dict(path=name, sha256=parsed['sha256'], association=assoc, origin=origin,
                       size=stat.st_size if stat else None, mtime_ns=str(stat.st_mtime_ns) if stat else None,
                       errors=parsed['errors'], unknown_events=parsed['unknown'])
            out['sources'].append(src)
            partial |= parsed['partial'] or assoc in {'unknown', 'mismatch'}
            if assoc in {'unknown', 'mismatch'}:
                continue
            supported += parsed['supported']
            terminal |= parsed['terminal']
            sent_hashes.extend(parsed['prompts'][:1])
            if parsed['initial']:
                out['coverage']['initial_context'] = 'visible_partial'
            for e in parsed['events']:
                for kind, observation, target_path in classify(e, str(ws or ''), policy, self.model):
                    identity = {k: e[k] for k in ('session', 'call_id', 'tool', 'arguments', 'result', 'role', 'operation', 'status')}
                    if not e['call_id']:
                        identity['line'] = e['line']
                    evidence = digest(identity)
                    fid = digest([evidence, kind, target_path])[:24]
                    if fid in seen:
                        continue
                    seen.add(fid)
                    out['findings'].append(dict(id=fid, evidence_id=evidence, finding_kind=kind,
                        observation=observation, review_state='pending', policy_applicability='historical_observation' if not policy and kind in {'auxiliary_skill', 'skill_injection'} else 'applicable',
                        source=name, line=e['line'], end_line=e['end_line'], log_sha256=parsed['sha256'],
                        session=e['session'], call_id=e['call_id'], role=e['role'], operation=e['operation'],
                        tool=redact(e['tool']), target=redact(target_path), result_status=e['status'],
                        summary=f'{kind}：{observation}；仅记录事件类别，正文不写入报告'))
        if sent_hashes and ph:
            out['prompt_provenance']['sent'] = 'verified' if all(h == ph for h in sent_hashes) else 'different'
        if out['sources']:
            out['coverage']['tools'] = 'partial' if partial or not supported or not terminal or not m.get('ended_at') else 'parseable'
        # 原交接文件自报是线索，不是独立的无污染证明。
        final = ws / 'FINAL_MESSAGE.md' if ws else None
        if final and final.is_file() and not linked(final, ws) and final.stat().st_size <= 1024 * 1024:
            body = final.read_text('utf-8-sig', errors='replace')
            if SELF_REPORT.search(body):
                ev = file_hash(final)
                out['findings'].append(dict(id=digest(['self_report', ev])[:24], evidence_id=ev, finding_kind='self_report',
                    observation='self_report', review_state='pending', policy_applicability='applicable', source=str(final), line=1,
                    log_sha256=ev, summary='交接文档自报异常；不复述内容'))
        out['pending_count'] = len(out['findings'])
        out['inputs'] = []
        for p in (r['meta_path'], pf, final):
            if p and p.is_file() and not linked(p, Path(p.anchor)):
                stat = p.stat()
                out['inputs'].append(dict(path=str(p), sha256=file_hash(p), size=stat.st_size, mtime_ns=str(stat.st_mtime_ns)))
        self._apply_reviews(out, self._directory(r))
        if save:
            self._save(out, r)
        return out

    def _directory(self, r):
        return self.data / 'context-audits' / digest((r['ref'] or r['run_id']).encode())

    def _apply_reviews(self, report, directory):
        reviews = []
        for p in sorted(directory.glob('review-*.json')):
            if not linked(p, self.data):
                reviews.append(read_json(p))
        for f in report.get('findings', []):
            for rv in sorted(reviews, key=lambda x: x.get('at', '')):
                if rv.get('finding_id') == f['id'] and rv.get('evidence_id') == f['evidence_id']:
                    f['review_state'] = rv['decision']
                    f['review_note'] = rv['note']
        report['pending_count'] = sum(f['review_state'] == 'pending' for f in report.get('findings', []))

    def _write(self, path, value):
        if linked(path, self.data) or not path.is_relative_to(self.data / 'context-audits'):
            raise ValueError('拒绝写入审计目录外或链接路径')
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
        with temp.open('x', encoding='utf-8') as f:
            json.dump(value, f, ensure_ascii=False, indent=2)
            f.write('\n')
        os.replace(temp, path)

    def _save(self, report, r):
        directory = self._directory(r)
        name = 'report-' + uuid.uuid4().hex + '.json'
        self._write(directory / name, report)
        self._write(directory / 'current.json', dict(schema='context-audit-index/1', report=name, ref=r['ref'], run_id=r['run_id']))

    def latest(self, target):
        r = self.resolve(target)
        directory = self._directory(r)
        index = read_json(directory / 'current.json') if not linked(directory, self.data) else {}
        name = index.get('report', '')
        if not re.fullmatch(r'report-[a-f0-9]+\.json', name):
            return None
        rp = directory / name
        report = read_json(rp) if not linked(rp, self.data) else {}
        if not report:
            return None
        report['stale'] = False
        for src in report.get('sources', []) + report.get('inputs', []):
            p = Path(src['path'])
            if not p.is_file() or linked(p, Path(p.anchor)) or file_hash(p) != src.get('sha256'):
                report['stale'] = True
        for finding in report.get('findings', []):
            if finding['finding_kind'] == 'self_report' and finding.get('observation') == 'self_report' and finding.get('source', '').endswith('FINAL_MESSAGE.md'):
                p = Path(finding['source'])
                if not p.is_file() or file_hash(p) != finding['log_sha256']:
                    report['stale'] = True
        self._apply_reviews(report, directory)
        return report

    def review(self, target, finding_id, decision, note, save=False):
        if decision not in {'confirmed', 'dismissed'} or not note.strip():
            raise ValueError('复核需要 confirmed|dismissed 和依据')
        r = self.resolve(target)
        report = self.latest(target)
        if not report or report.get('stale'):
            raise ValueError('报告缺失或已过期，请重新 audit --save')
        finding = next((f for f in report['findings'] if f['id'] == finding_id), None)
        if not finding:
            raise ValueError('线索不存在')
        rv = dict(schema='context-review/1', at=now(), finding_id=finding_id, evidence_id=finding['evidence_id'], decision=decision, note=redact(note))
        if save:
            self._write(self._directory(r) / ('review-' + uuid.uuid4().hex + '.json'), rv)
        return rv
