"""上下文日志适配器。只解析明确的事件字段，不执行日志内容，不递归解释工具输出。"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re

MAX_LINE = 2 * 1024 * 1024


def digest(value):
    if not isinstance(value, bytes):
        value = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()
    return hashlib.sha256(value).hexdigest()


def file_hash(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def text(value):
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return '\n'.join(text(x) for x in value)
    if isinstance(value, dict):
        return text(value.get('text', value.get('content', value.get('output', ''))))
    return ''


def arguments(value):
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return {'command': value}
    return value if isinstance(value, dict) else {}


def command_text(args):
    return str(next((v for k, v in args.items() if k.lower().replace('_', '') in {'command', 'cmd', 'commandline', 'script'}), ''))


def _status(event, result, tool, args):
    nested = result if isinstance(result, dict) else {}
    if nested.get('isError') or nested.get('is_error') or nested.get('error'):
        return 'failed'
    code = event.get('exit_code', event.get('status_code', nested.get('status_code')))
    state = str(event.get('status', event.get('state', ''))).lower()
    output = text(result) if isinstance(result, (str, list)) else json.dumps(result, ensure_ascii=False) if result is not None else ''
    if event.get('is_error') or state in {'failed', 'error', 'denied', 'rejected'} or (isinstance(code, int) and code != 0 and not 200 <= code < 300):
        return 'failed'
    if re.search(r'permission denied|access denied|not found|cannot find|拒绝访问|无权|不存在|Traceback', output, re.I):
        return 'failed'
    if result is None:
        return 'attempt'
    command = command_text(args)
    if re.match(r'^\s*(?:echo|printf|Write-Output)\b', command, re.I) and not re.search(r'[;|&$`\n]', command):
        return 'mention'
    if command and (re.search(r';|&|\||\$|`|%\w+%|\n', command) or re.search(r'\b(?:python|node|eval|exec)\b', command)):
        # 复合命令的整体成功不能证明其中每个读取成功。
        return 'attempt'
    if output.strip() and (state in {'success', 'completed', 'done'} or code == 0 or not command):
        return 'obtained'
    return 'attempt'


def parse_log(path):
    """返回临时原始事件与覆盖信息；原始参数/正文不进入持久化报告。"""
    path = Path(path)
    out = dict(path=str(path), sha256=None, events=[], metadata={}, contexts=[], prompts=[], initial=False,
               partial=False, supported=0, unknown=0, terminal=False, errors=[])
    calls = {}
    session, cwd = '', ''

    def emit(lineno, tool, args=None, result=None, event=None, cid='', role='assistant', operation='tool'):
        event = event or {}
        args = arguments(args)
        key = str(cid or f'line:{lineno}')
        slot = calls.get(key)
        if slot is None:
            slot = dict(line=lineno, end_line=lineno, session=session, call_id=str(cid), role=role,
                        operation=operation, tool=tool, arguments=args, result=None,
                        cwd=event.get('cwd', args.get('cwd', args.get('workdir', cwd))), status='attempt')
            calls[key] = slot
            out['events'].append(slot)
        if tool:
            slot['tool'] = tool
        if args:
            slot['arguments'] = args
        if result is not None:
            slot['result'] = result
        slot['end_line'] = lineno
        slot['status'] = _status(event, slot['result'], slot['tool'], slot['arguments'])
        out['supported'] += 1

    try:
        out['sha256'] = file_hash(path)
        with path.open('rb') as stream:
            lineno = 0
            while True:
                line = stream.readline(MAX_LINE + 1)
                if not line:
                    break
                lineno += 1
                if len(line) > MAX_LINE:
                    while line and not line.endswith(b'\n'):
                        line = stream.readline(MAX_LINE + 1)
                    out['partial'] = True
                    out['errors'].append(f'{lineno}: 超长行未解析')
                    continue
                try:
                    e = json.loads(line.decode('utf-8-sig'))
                    if not isinstance(e, dict):
                        raise ValueError('not object')
                except (ValueError, UnicodeError):
                    out['partial'] = True
                    out['errors'].append(f'{lineno}: 非 JSON / 未写完的行')
                    emit(lineno, 'candidate_search', {'text': line.decode('utf-8-sig', errors='replace')}, operation='candidate')
                    continue
                typ = e.get('type', e.get('event', ''))
                if typ in {'session_meta', 'init', 'system'} and (typ != 'system' or e.get('subtype') == 'init'):
                    m = e.get('payload', e)
                    session = str(m.get('id', m.get('session_id', m.get('conversation_id', session))))
                    cwd = m.get('cwd', cwd)
                    out['metadata'].update({k: m[k] for k in ('cwd', 'model', 'model_id', 'timestamp') if k in m})
                    out['metadata']['session'] = session
                    out['contexts'].append(dict(out['metadata']))
                    out['supported'] += 1
                    continue
                if typ == 'turn_context':
                    m = e.get('payload', {})
                    for k in ('cwd', 'model'):
                        if m.get(k):
                            out['metadata'][k] = m[k]
                    cwd = m.get('cwd', cwd)
                    continue
                if typ in {'result', 'end', 'turn.completed', 'turn.failed'}:
                    out['terminal'] = True
                    out['supported'] += 1
                    continue
                if typ == 'event_msg':
                    p = e.get('payload', {})
                    if p.get('type') in {'task_complete', 'task_completed'}:
                        out['terminal'] = True
                    if p.get('type') == 'user_message' and isinstance(p.get('message'), str):
                        out['prompts'].append(digest(p['message'].encode()))
                    # usage/thought/进度事件不冒充工具事件。
                    continue
                if typ == 'response_item':
                    p = e.get('payload', {})
                    ptype = p.get('type')
                    if ptype in {'function_call', 'custom_tool_call'}:
                        emit(lineno, p.get('name', ''), p.get('arguments', p.get('input')), cid=p.get('call_id', ''))
                    elif ptype in {'function_call_output', 'custom_tool_call_output'}:
                        emit(lineno, '', result=p.get('output'), event=p, cid=p.get('call_id', ''))
                    elif ptype == 'message':
                        role = p.get('role', '')
                        body = text(p.get('content', ''))
                        if role == 'user':
                            out['prompts'].append(digest(body.encode()))
                        elif role in {'system', 'developer'}:
                            out['initial'] = True
                            emit(lineno, 'initial_context', {'text': body}, body, role=role, operation='injection')
                        elif role == 'assistant':
                            emit(lineno, 'assistant_message', {'text': body}, body, operation='message')
                    elif ptype not in {'reasoning', 'compaction'}:
                        out['unknown'] += 1
                    continue
                if typ in {'item.started', 'item.updated', 'item.completed'}:
                    p = e.get('item', {})
                    pt = p.get('type')
                    if pt == 'command_execution':
                        emit(lineno, 'shell', {'command': p.get('command', ''), 'cwd': p.get('cwd', cwd)},
                             p.get('aggregated_output') if typ == 'item.completed' else None,
                             event=p, cid=p.get('id', ''))
                    elif pt == 'mcp_tool_call':
                        emit(lineno, f"{p.get('server', '')}.{p.get('tool', '')}", p.get('arguments'),
                             p.get('result'), event=p, cid=p.get('id', ''))
                    elif pt == 'agent_message':
                        emit(lineno, 'assistant_message', {'text': p.get('text', '')}, p.get('text'), operation='message', cid=p.get('id', ''))
                    elif pt not in {'reasoning', 'todo_list', 'file_change'}:
                        out['unknown'] += 1
                    continue
                if isinstance(e.get('step_update'), dict):
                    p = e['step_update']
                    cid = 'step:' + str(p.get('step_index', e.get('step_index', lineno)))
                    if p.get('step_type') == 'tool':
                        emit(lineno, p.get('tool_name', ''), p.get('tool_input', p.get('input', p.get('arguments'))),
                             p.get('tool_output', p.get('output', p.get('result'))), event=p, cid=cid)
                    elif p.get('step_type') == 'agent_response':
                        emit(lineno, 'assistant_message', {'text': text(p.get('text', p.get('response', '')))}, operation='message', cid=cid)
                    else:
                        out['unknown'] += 1
                    continue
                if typ in {'tool', 'tool_call', 'tool_call_update', 'tool_result'}:
                    tool = e.get('name', e.get('toolName', e.get('tool_name', '')))
                    args = e.get('arguments', e.get('input', e.get('rawInput')))
                    result = e.get('result', e.get('output', e.get('rawOutput')))
                    if isinstance(e.get('tool_call'), dict):
                        tc = e['tool_call']
                        tool = next(iter(tc), tool)
                        details = tc.get(tool, {})
                        if isinstance(details, dict):
                            args = details.get('args', details.get('arguments', args))
                            result = details.get('result', result)
                    emit(lineno, tool, args, result, event=e, cid=e.get('call_id', e.get('toolCallId', e.get('id', ''))), role=e.get('role', 'assistant'))
                    continue
                if typ in {'assistant', 'user', 'system', 'developer'}:
                    body = text(e.get('text', e.get('content', '')))
                    if typ == 'user':
                        out['prompts'].append(digest(body.encode()))
                    else:
                        injection = typ in {'system', 'developer'}
                        out['initial'] |= injection
                        emit(lineno, 'initial_context' if injection else 'assistant_message', {'text': body}, body,
                             role=typ, operation='injection' if injection else 'message')
                    continue
                if typ == 'thread.started':
                    session = str(e.get('thread_id', session))
                    out['metadata']['session'] = session
                elif typ not in {'turn.started', 'usage', 'thought', 'heartbeat'}:
                    out['unknown'] += 1
                    emit(lineno, 'candidate_search', {'text': json.dumps(e, ensure_ascii=False)}, operation='candidate')
        if out['unknown'] or not out['supported']:
            out['partial'] = True
        if any(e['status'] == 'attempt' and e['operation'] == 'tool' for e in out['events']):
            out['partial'] = True
    except OSError as exc:
        out['partial'] = True
        out['errors'].append(type(exc).__name__)
    return out
